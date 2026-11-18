import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { takeFlash } from '../../app/flash';
import { listTemplates } from '../../db/forms';
import { listForShip } from '../../db/records';
import type { Alert } from '../../domain/alerts';
import type { FormDraft, ShipProfile } from '../../domain/types';
import { currentVoyage } from '../../domain/voyage';
import { loadFormsEngine } from '../../forms/load';
import { DueRow } from '../components/DueRow';
import { dueRow, NOTHING_DUE } from '../dueView';
import { backupReminder, formsInProgress, PERSISTENCE_DENIED_NOTICE } from '../homeView';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { voyageCard } from '../overviewView';
import type { VoyageCardView } from '../overviewView';
import { useShipAlerts, useShipRecords } from '../useShipRecords';
import { useLive } from '../useLive';

/** How many alerts Home lists; `See all` opens the Due screen with every one. */
const DUE_ON_HOME = 3;

/** The quick actions at the foot of Home, as drawn. `+ Expense` (the one with `label`) is the accent tile. */
const TILES: { name: string; href: string; icon: IconName; label?: string }[] = [
  { name: 'Crew', href: '#/ship/crew', icon: 'crew' },
  { name: 'Fill form', href: '#/forms', icon: 'forms' },
  { name: 'Draft survey', href: '#/ship/survey', icon: 'draft' },
  { name: 'Expense', label: '+ Expense', href: '#/budget/add', icon: 'plus' },
  { name: 'Converter', href: '#/tools', icon: 'convert' },
  { name: 'Library', href: '#/library', icon: 'book' },
];

/** `Not now` on the backup banner: kept while the app is open, never stored, so the banner is back at the next start. */
let backupDismissed = false;

/** A figure of the voyage card: a label, the figure in Mono, and a caption under it. */
function Figure({ label, value, caption, testId }: { label: string; value: string; caption?: string; testId: string }) {
  return (
    <p class="figure">
      <span class="list-row-meta">{label}</span>
      <span class="figure-value" data-testid={testId}>{value}</span>
      {caption && <span class="list-row-meta">{caption}</span>}
    </p>
  );
}

/** The current voyage, its route, the ETA countdown, the crew on board and the next clock change; or that there is no voyage. */
function VoyageCard({ view }: { view: VoyageCardView }) {
  const { eta } = view;
  return (
    <section class="hub-tile voyage-card" aria-label="Voyage">
      <p class="list-row-overline">{view.overline}</p>
      {view.route && <p class="voyage-route">{view.route}</p>}
      <div class="figures">
        {!eta && <p class="figure"><a class="btn btn-outline" href="#/ship/voyage">Start voyage</a></p>}
        {eta && ('missing' in eta
          ? <p class="figure"><span class="list-row-meta">{eta.missing}</span></p>
          : <Figure label="ETA in" value={eta.countdown} caption={eta.local} testId="eta-countdown" />)}
        <Figure label="On board" value={String(view.onBoard)} caption={view.clockChange} testId="on-board" />
      </div>
    </section>
  );
}

/** The three most urgent alerts, in the order `collectAlerts` gives them, and `See all N`; `✓ Nothing due` when there is none. */
function DueList({ alerts, today }: { alerts: Alert[]; today: string }) {
  return (
    <section class="home-section" aria-labelledby="home-due">
      <div class="home-head">
        <h2 id="home-due">Due</h2>
        {alerts.length > 0 && <a href="#/due">See all {alerts.length}</a>}
      </div>
      {alerts.length === 0 ? <p class="due-none">{NOTHING_DUE}</p> : (
        <ul class="row-list" role="list">
          {alerts.slice(0, DUE_ON_HOME).map((alert) => <DueRow key={alert.key} row={dueRow(alert, today)} />)}
        </ul>
      )}
    </section>
  );
}

/** What Home shows of one ship. Keyed by the ship, so that one ship's card and alerts are never shown under another's name. */
function Today({ ship }: { ship: ShipProfile }) {
  const { shipToday, nowUtc, clockChanges, offsetMinutes } = useAppState();
  const records = useShipRecords(ship.id);
  const alerts = useShipAlerts(records, ship);
  const card = useMemo(
    () => records && voyageCard({ voyage: currentVoyage(records.voyages), crew: records.crew, today: shipToday, now: nowUtc, clockChanges, offsetMinutes }),
    [records, shipToday, nowUtc, clockChanges, offsetMinutes],
  );
  if (!card || !alerts) return null;
  return (
    <>
      <VoyageCard view={card} />
      <DueList alerts={alerts} today={shipToday} />
    </>
  );
}

/** A compact section of Home (Forms in progress, Budget alerts): its heading and 48 px rows. */
function CompactRows({ name, rows, extra = '', children }: {
  name: string; rows: { key: string; text: string; href?: string }[]; extra?: string; children?: ComponentChildren;
}) {
  return (
    <section class={`home-section ${extra}`} aria-label={name}>
      <h2>{name}</h2>
      {children}
      <ul class="row-list" role="list">
        {rows.map((row) => (
          <li key={row.key}>
            {row.href
              ? <a class="list-row compact" href={row.href}><span class="list-row-title">{row.text}</span></a>
              : <span class="list-row compact"><span class="list-row-title">{row.text}</span></span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The forms the ship has started and not finished, each linking to its fill screen. Nothing is shown while there are
 * none. The period is worded by the forms engine, which is loaded only when there is a draft to word.
 */
function FormsInProgress({ shipId }: { shipId: string }) {
  const { db, shipToday } = useAppState();
  const data = useLive(async () => {
    const [templates, drafts] = await Promise.all([listTemplates(db), listForShip<FormDraft>(db, 'formDrafts', shipId)]);
    return { templates, drafts };
  }, [db, shipId]);
  const hasDrafts = data !== undefined && data.drafts.some((d) => !d.deleted);
  // `null` when the engine could not be loaded: the periods are then shown as kept.
  const [periodLabel, setPeriodLabel] = useState<((period: string) => string) | null>();
  useEffect(() => {
    if (hasDrafts) loadFormsEngine().then((engine) => setPeriodLabel(() => engine.periodLabel), () => setPeriodLabel(null));
  }, [hasDrafts]);
  const rows = useMemo(
    () => (data && hasDrafts && periodLabel !== undefined
      ? formsInProgress(data.drafts, data.templates, shipToday, periodLabel ?? ((period) => period))
      : []),
    [data, hasDrafts, periodLabel, shipToday],
  );
  if (rows.length === 0) return null;
  return <CompactRows name="Forms in progress" rows={rows} />;
}

type BudgetAlertLine = { key: string; text: string; href: string };

/**
 * The personal budget alerts (base §3.8): on this device's Home only, never printed. The budget's own code is loaded on
 * demand (with the Budget screens' chunk, once the budget is set up); this is just its count and short lines.
 */
function BudgetAlerts() {
  const { db, shipToday } = useAppState();
  const [alerts, setAlerts] = useState<BudgetAlertLine[]>([]);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    // The budget's chunk is loaded only once the budget has been set up: before that it has nothing to say.
    db.budgetSettings.filter((r) => !r.deleted).count()
      .then((n) => (n > 0 && live ? import('./budget') : undefined))
      .then((m) => { if (m && live) stop = m.watchBudgetAlerts(db, shipToday, setAlerts, reportError); }, () => {});
    return () => { live = false; stop?.(); };
  }, [db, shipToday]);
  if (alerts.length === 0) return null;
  return (
    <CompactRows name="Budget alerts" rows={alerts} extra="no-print">
      <p>{alerts.length} budget alert{alerts.length === 1 ? '' : 's'}</p>
    </CompactRows>
  );
}

/**
 * The first screen, Today (spec §7): the backup and storage banners, the voyage card, the three most urgent alerts, the
 * forms in progress and the personal budget alerts, then six quick-action tiles at the foot, just above the bottom bar.
 * Nothing of the budget's own code is imported here: it is a chunk of its own.
 */
export function Home() {
  const { settings, activeShip, nowUtc, persistence } = useAppState();
  // Taken once, when this screen opens. The status stays on the page and only its text changes, so that it is announced.
  const [flash, setFlashText] = useState('');
  useEffect(() => setFlashText(takeFlash() ?? ''), []);
  const [dismissed, setDismissed] = useState(backupDismissed);

  const reminder = dismissed ? undefined : backupReminder(settings, activeShip !== undefined, nowUtc);

  return (
    <section class="screen home">
      <h2 class="visually-hidden">Home</h2>
      <p class="live" role="status">{flash}</p>
      {reminder && (
        <div class="home-notice no-print">
          <p>{reminder}</p>
          <a class="btn btn-primary" href="#/settings">Export full backup</a>
          <button type="button" class="btn btn-outline" onClick={() => { backupDismissed = true; setDismissed(true); }}>Not now</button>
        </div>
      )}
      {persistence === 'denied' && (
        <div class="home-notice no-print">
          <p>{PERSISTENCE_DENIED_NOTICE}</p>
        </div>
      )}
      {activeShip && <Today key={activeShip.id} ship={activeShip} />}
      {activeShip && <FormsInProgress key={activeShip.id} shipId={activeShip.id} />}
      <BudgetAlerts />
      <nav class="home-tiles no-print" aria-label="Quick actions">
        {TILES.map((tile) => (
          <a key={tile.href} class="hub-tile home-tile" href={tile.href} aria-label={tile.label} data-accent={tile.label ? '' : undefined}>
            {tile.label ? <Icon name={tile.icon} /> : <span class="hub-icon"><Icon name={tile.icon} /></span>}
            {tile.name}
          </a>
        ))}
      </nav>
    </section>
  );
}
