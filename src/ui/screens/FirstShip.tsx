import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { createShip } from '../../db/ships';
import { deviceOffsetMinutes } from '../../domain/shipTime';
import { LogoMark } from '../components/LogoMark';
import { OffsetSelect } from '../components/OffsetSelect';
import { logoMode } from '../theme';

/** The welcome screen, shown full screen while there is no ship: create the first ship, or import a backup. */
export function FirstShip() {
  const { db, settings } = useAppState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [offset, setOffset] = useState(() => deviceOffsetMinutes());
  const [nameError, setNameError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Ship name is required.');
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await createShip(db, trimmed, offset);
      // The new ship arrives through the app state, which replaces this screen. Staying busy until then stops a second tap from making a second ship.
    } catch (err) {
      setBusy(false);
      reportError(err);
    }
  }

  return (
    <main class="welcome">
      <div class="welcome-band">
        <LogoMark size={120} mode={logoMode(settings.theme)} />
        <h1>Masterpiece</h1>
      </div>
      <div class="welcome-body">
        <p class="tagline">Your ship's office in your pocket. Crew, certificates and paperwork — fully offline.</p>
        {creating ? (
          <form class="first-ship-form" aria-labelledby="first-ship-heading" onSubmit={submit} noValidate>
            <h2 id="first-ship-heading">Create your first ship</h2>
            <div class="field">
              <label for="ship-name">Ship name</label>
              <input
                id="ship-name" ref={nameInput} type="text" autocomplete="off" aria-required="true"
                aria-invalid={nameError ? 'true' : undefined} aria-describedby={nameError ? 'ship-name-error' : undefined}
                value={name}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setNameError(undefined);
                }}
              />
              {nameError && <p id="ship-name-error" class="field-error" role="alert">{nameError}</p>}
            </div>
            <OffsetSelect value={offset} onChange={setOffset} />
            <button type="submit" class="btn btn-primary btn-large" disabled={busy}>Create ship</button>
          </form>
        ) : (
          <button type="button" class="btn btn-primary btn-large" onClick={() => setCreating(true)}>Create your first ship</button>
        )}
        <a class="btn btn-outline btn-large" href="#/settings/import">Import a backup</a>
        <p class="helper">New phone or taking over from your relief? Import their backup or handover file.</p>
        <div class="welcome-spacer" />
        <p class="privacy-note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Your data stays on this device. No account needed.
        </p>
      </div>
    </main>
  );
}
