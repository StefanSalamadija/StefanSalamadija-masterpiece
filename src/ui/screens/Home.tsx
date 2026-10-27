import { useEffect, useState } from 'preact/hooks';
import { takeFlash } from '../../app/flash';

/** A placeholder until the dashboard is built. It already shows what the screen before left to say, such as "Import complete." */
export function Home() {
  // Taken once, when this screen opens. The status stays on the page and only its text changes, so that it is announced.
  const [flash, setFlashText] = useState('');
  useEffect(() => setFlashText(takeFlash() ?? ''), []);
  return (
    <section class="screen">
      <h2>Home</h2>
      <p class="live" role="status">{flash}</p>
      <p>
        <a href="#/ship/particulars">Ship's data</a>
      </p>
    </section>
  );
}
