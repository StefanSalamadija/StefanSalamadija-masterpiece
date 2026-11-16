import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useAppState } from '../../../app/AppState';
import { reportError } from '../../../app/errors';
import { useRoute } from '../../../app/router';
import { ensureBudgetSetup } from '../../../db/budget';
import type { MasterpieceDB } from '../../../db/schema';
import { dismissUndo, pauseUndo, resumeUndo, useUndoNotice } from './undoToast';
import './budget.css';

/** The set-up of each database, run once (the first use of the budget seeds its categories and settings). */
const setups = new WeakMap<MasterpieceDB, Promise<void>>();

function setUp(db: MasterpieceDB): Promise<void> {
  let setup = setups.get(db);
  if (!setup) {
    setup = ensureBudgetSetup(db);
    setups.set(db, setup);
    setup.catch(() => setups.delete(db)); // the next visit tries again
  }
  return setup;
}

/** Whether the budget is set up, setting it up on first use. */
function useBudgetReady(): boolean {
  const { db } = useAppState();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setUp(db).then(() => { if (live) setReady(true); }, reportError);
    return () => { live = false; };
  }, [db]);
  return ready;
}

/** The current month, `YYYY-MM`, of the ship's today. */
export function useCurrentYm(): string {
  return useAppState().shipToday.slice(0, 7);
}

function BudgetNav() {
  const { path } = useRoute();
  const ym = useCurrentYm();
  const links: { label: string; href: string; active: boolean }[] = [
    { label: 'Dashboard', href: '#/budget', active: path === '/budget' },
    { label: 'Month', href: `#/budget/month/${ym}`, active: path === '/budget/month/:ym' },
    { label: 'Forecast', href: '#/budget/forecast', active: path === '/budget/forecast' },
    { label: 'Net worth', href: '#/budget/net-worth', active: path === '/budget/net-worth' },
    { label: 'Scenarios', href: '#/budget/scenarios', active: path.startsWith('/budget/scenarios') },
    { label: 'Plan', href: '#/budget/plan', active: path.startsWith('/budget/plan') },
  ];
  return (
    <nav class="budget-nav no-print" aria-label="Budget sections">
      <div class="chips">
        {links.map((l) => <a key={l.label} href={l.href} class="chip" aria-current={l.active ? 'page' : undefined}>{l.label}</a>)}
      </div>
    </nav>
  );
}

function UndoToast() {
  const notice = useUndoNotice();
  // The region stays on the page, so that a screen reader announces each new message. It comes early in the page (it is
  // drawn at the foot of the screen), so that the keyboard reaches its Undo within a few Tabs.
  return (
    <div class="budget-toast-region no-print" role="status">
      {notice && (
        <div
          key={notice.key} class="budget-toast" onMouseEnter={pauseUndo} onMouseLeave={resumeUndo} onFocusIn={pauseUndo}
          onFocusOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeUndo(); }}
        >
          <span class="toast-message">{notice.message}</span>
          <button type="button" class="btn btn-small budget-toast-undo" onClick={() => { dismissUndo(); notice.undo().catch(reportError); }}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What every Budget screen has: the budget's tabs, the "+ Expense" button (left out on quick add itself) and the Undo
 * toast. The screen is drawn once the budget is set up.
 */
export function BudgetFrame({ title, children, addButton = true }: { title: string; children: ComponentChildren; addButton?: boolean }) {
  const ready = useBudgetReady();
  return (
    <section class="screen budget">
      <BudgetNav />
      <UndoToast />
      <div class="screen-head">
        <h2>{title}</h2>
        {addButton && <a class="btn btn-primary no-print" href="#/budget/add">+ Expense</a>}
      </div>
      {ready ? children : <p class="live" role="status">Loading…</p>}
    </section>
  );
}
