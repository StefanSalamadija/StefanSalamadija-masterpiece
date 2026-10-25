import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { navigate } from '../../app/router';
import { createRecord, listForShip, softDelete, updateRecord } from '../../db/records';
import { rankLabel } from '../../domain/catalogues';
import { fullName, rejoinDraft, visibleCrew } from '../../domain/crew';
import { crewDocBand } from '../../domain/expiry';
import type { CrewMember, FieldError } from '../../domain/types';
import { BandBadge } from '../components/BandBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { rejoinProblem, signOffProblem } from '../crewForm';
import { crewListView, resolveAsAt, setCrewListView } from '../crewListView';
import type { CrewListView } from '../crewListView';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

/** What every dialog of this screen is given. */
interface DialogProps {
  member: CrewMember;
  onClose: () => void;
  /** Where the focus goes when the button that opened the dialog is gone. */
  focusFallback: RefObject<HTMLElement | null>;
}

/** A dialog that asks for a date and a port. The date is checked before anything is written. */
interface DateAndPortProps extends Omit<DialogProps, 'member'> {
  title: string;
  confirmLabel: string;
  dateLabel: string;
  portLabel: string;
  initialDate: string;
  initialPort: string;
  /** What is wrong with the date, if anything. */
  check: (date: string) => FieldError | undefined;
  /** Does the work with the date and the trimmed port. A failure is shown in the dialog, which stays open. */
  onSubmit: (date: string, port: string) => Promise<void>;
}

function DateAndPortDialog({
  title, confirmLabel, dateLabel, portLabel, initialDate, initialPort, check, onSubmit, onClose, focusFallback,
}: DateAndPortProps) {
  const [date, setDate] = useState(initialDate);
  const [port, setPort] = useState(initialPort);
  const [error, setError] = useState<FieldError>();
  const { busy, failure, run } = useDialogAction();
  const dateInput = useRef<HTMLInputElement>(null);

  function confirm(): void {
    const found = check(date);
    if (found) {
      setError(found);
      dateInput.current?.focus();
      return;
    }
    void run(() => onSubmit(date, port.trim()));
  }

  return (
    <ConfirmDialog
      title={title} confirmLabel={confirmLabel} busy={busy} error={failure} focusFallback={focusFallback}
      onConfirm={confirm} onCancel={onClose}
      body={
        <>
          <Field
            label={dateLabel} type="date" value={date} error={error} inputRef={dateInput}
            onInput={(value) => {
              setDate(value);
              setError(undefined);
            }}
          />
          <Field label={portLabel} value={port} onInput={setPort} />
        </>
      }
    />
  );
}

function SignOffDialog({ member, ...dialog }: DialogProps) {
  const { db, shipToday } = useAppState();
  return (
    <DateAndPortDialog
      {...dialog} title={`Sign off ${fullName(member)}`} confirmLabel="Sign off"
      dateLabel="Sign-off date" portLabel="Sign-off port"
      // A contract that is already signed off can be signed off again, to correct the date or the port.
      initialDate={member.signOffDate || shipToday} initialPort={member.signOffPort ?? ''}
      check={(date) => signOffProblem(member, date, shipToday)}
      // The screen closes this dialog once the list shows the sign-off, which is after the row may have left the
      // view, so the focus can go to the fallback and not to a button that is about to disappear.
      onSubmit={async (date, port) => {
        await updateRecord<CrewMember>(db, 'crew', member.id, { signOffDate: date, signOffPort: port });
      }}
    />
  );
}

function RejoinDialog({ member, onClose, ...dialog }: DialogProps) {
  const { db, shipToday } = useAppState();
  return (
    <DateAndPortDialog
      {...dialog} onClose={onClose} title={`Re-join ${fullName(member)}`} confirmLabel="Re-join"
      dateLabel="Sign-on date" portLabel="Sign-on port" initialDate={shipToday} initialPort=""
      check={(date) => rejoinProblem(member, date, shipToday)}
      // A new contract; the signed-off one stays as it is, and so does its row.
      onSubmit={async (date, port) => {
        await createRecord<CrewMember>(db, 'crew', { shipId: member.shipId, ...rejoinDraft(member, date, port) });
        onClose();
      }}
    />
  );
}

function DeleteCrewDialog({ member, onClose, focusFallback }: DialogProps) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title={`Delete ${fullName(member)}?`} confirmLabel="Delete crew member" danger
      busy={busy} error={failure} focusFallback={focusFallback}
      // The screen closes this dialog when the contract leaves the list, which is after its row is gone.
      onConfirm={() => void run(() => softDelete(db, 'crew', member.id))} onCancel={onClose}
      body={<p>This removes this contract from the crew list on this device.</p>}
    />
  );
}

type DialogState = { kind: 'signOff' | 'rejoin' | 'delete'; member: CrewMember };

/** "Signed on 2026-06-01 at Santos · Signed off 2026-10-10", to tell the contracts of one person apart. */
function contractText(m: CrewMember): string {
  const on = `Signed on ${m.signOnDate}${m.signOnPort ? ` at ${m.signOnPort}` : ''}`;
  if (!m.signOffDate) return on;
  return `${on} · Signed off ${m.signOffDate}${m.signOffPort ? ` at ${m.signOffPort}` : ''}`;
}

function CrewList({ shipId }: { shipId: string }) {
  const { db, shipToday } = useAppState();
  const crew = useLive(() => listForShip<CrewMember>(db, 'crew', shipId), [db, shipId]);
  const [looking, setLooking] = useState(crewListView);
  const [requested, setDialog] = useState<DialogState>();
  const addLink = useRef<HTMLAnchorElement>(null);

  const asAt = resolveAsAt(looking.asAt, shipToday);
  const rows = crew && visibleCrew(crew, looking.view, asAt);
  const look = (change: Partial<CrewListView>): void => setLooking(setCrewListView(change));

  // A dialog about a contract that is gone, or was changed meanwhile (here or in another tab), is closed.
  const subject = requested && crew?.find((m) => m.id === requested.member.id);
  const dialog = requested && subject?.updatedAt === requested.member.updatedAt ? requested : undefined;
  const dialogProps = dialog && { member: dialog.member, onClose: () => setDialog(undefined), focusFallback: addLink };

  return (
    <section class="screen">
      <div class="screen-head">
        <h2>Crew</h2>
        <div class="head-actions">
          <a ref={addLink} class="btn btn-primary" href="#/ship/crew/new">Add crew member</a>
          <a class="btn btn-outline" href="#/ship/crew/import">Import from Excel</a>
        </div>
      </div>
      <div class="crew-controls">
        <Field label="As at" type="date" value={looking.asAt ?? shipToday} onInput={(asAtText) => look({ asAt: asAtText })} />
        <div class="toggle" role="group" aria-label="Show">
          <button
            type="button" class="btn btn-outline btn-small" aria-pressed={looking.view === 'onboard'}
            onClick={() => look({ view: 'onboard' })}
          >
            Onboard
          </button>
          <button
            type="button" class="btn btn-outline btn-small" aria-pressed={looking.view === 'all'}
            onClick={() => look({ view: 'all' })}
          >
            All
          </button>
        </div>
      </div>
      {crew?.length === 0 && <p class="empty">No crew yet. Add a crew member, or import your crew list from Excel.</p>}
      {crew && crew.length > 0 && rows?.length === 0 && <p class="empty">Nobody is onboard on {asAt}.</p>}
      {rows && rows.length > 0 && (
        <ul class="crew-list" role="list" aria-label="Crew">
          {rows.map((m) => (
            <li key={m.id} class="card crew-row">
              <div class="crew-row-head">
                <div class="crew-row-who">
                  <span class="crew-rank">{rankLabel(m)}</span>
                  <span class="crew-name">{fullName(m)}</span>
                </div>
                <BandBadge band={crewDocBand(m, asAt)} kind="crew" />
              </div>
              <p class="crew-row-meta">{contractText(m)}</p>
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-small" onClick={() => navigate(`/ship/crew/${encodeURIComponent(m.id)}`)}>Edit</button>
                <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'signOff', member: m })}>Sign off</button>
                {m.signOffDate && (
                  <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'rejoin', member: m })}>Re-join</button>
                )}
                <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'delete', member: m })}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'signOff' && dialogProps && <SignOffDialog {...dialogProps} />}
      {dialog?.kind === 'rejoin' && dialogProps && <RejoinDialog {...dialogProps} />}
      {dialog?.kind === 'delete' && dialogProps && <DeleteCrewDialog {...dialogProps} />}
    </section>
  );
}

/** The active ship's crew: who is onboard on a date, or every contract; sign off, re-join, edit and delete. */
export function Crew() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry a dialog across.
  return <CrewList key={activeShip.id} shipId={activeShip.id} />;
}
