import { useEffect, useState } from 'react';
import BodyPortal from './BodyPortal';
import AgeFields from './AgeFields';
import { apiFetch, getToken } from '../lib/api';
import { ageFrom } from '../lib/age.mjs';
import { sendAge } from '../lib/ageCheck';

// The age question for a new account that hasn't answered it yet (a first Google sign-in, or an
// email sign-up confirmed on another device): sends a waiting answer from sign-up first, then asks
// once when /auth/me says age_needed. Accounts made before the question existed are never asked.
// Under 13, the server deletes the account and lib/ageCheck signs out.
export default function AgeGate() {
  const [asking, setAsking] = useState(false);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) return undefined;
    let alive = true;
    (async () => {
      if (await sendAge() === 'under_13') return;
      const me = await apiFetch('/auth/me');
      if (alive && me?.age_needed) setAsking(true);
    })();
    return () => { alive = false; };
  }, []);

  if (!asking) return null;

  async function save(event) {
    event.preventDefault();
    if (ageFrom(year, month) === null) { setError('Enter the month and year you were born.'); return; }
    setBusy(true);
    setError('');
    const result = await sendAge({ year: Number(year), month: Number(month) });
    setBusy(false);
    if (result === 'saved') setAsking(false);
    else if (result !== 'under_13') setError('Couldn’t save that. Try again.');
  }

  return (
    <BodyPortal>
      <div className="c-scrim ag-scrim">
        <form className="c-sheet ag" role="dialog" aria-modal="true" aria-labelledby="ag-title" onSubmit={save}>
          <h2 id="ag-title" className="c-title ag-title">One quick question</h2>
          <p className="c-meta ag-lead">We ask everyone once, so Cordia can follow the rules for students of every age. Only the month and year are kept.</p>
          <AgeFields idPrefix="ag" month={month} year={year} onMonth={setMonth} onYear={setYear} disabled={busy} />
          {error && <p className="ag-error" role="alert">{error}</p>}
          <button type="submit" className="c-btn c-btn--primary ag-save" disabled={busy || !month || !year} aria-busy={busy}>{busy ? 'Saving…' : 'Continue'}</button>
          <style jsx>{`
            .ag { width: min(420px, 100%); display: grid; gap: 14px; }
            .ag-title, .ag-lead { margin: 0; }
            .ag-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
            .ag-save { justify-self: end; }
          `}</style>
        </form>
      </div>
    </BodyPortal>
  );
}
