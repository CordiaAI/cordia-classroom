import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import Toggle from './Toggle';

// Settings › Tutor: "Crude humor in memory tricks", for confirmed adults only. Accounts marked as
// minors or high school never see this card (the server decides: can_confirm).
export default function MemoryTrickSettings() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/memory-tricks/settings').then(data => { if (typeof data?.can_confirm === 'boolean') setState(data); });
  }, []);

  async function save(path, body) {
    setBusy(true);
    setError('');
    const data = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
    if (typeof data?.can_confirm === 'boolean') setState(data);
    else setError(apiErrorMessage(data?.detail, 'That couldn’t be saved. Try again.'));
    setBusy(false);
  }

  if (!state?.can_confirm) return null;
  return (
    <div className="c-card settings-card mts">
      <h2 className="c-section-title">Memory tricks</h2>
      {state.adult_confirmed ? (
        <>
          <Toggle
            checked={state.crude_humor}
            disabled={busy}
            onChange={value => save('/memory-tricks/settings', { crude_humor: value })}
            label="Crude humor in memory tricks"
            description="Help me remember may use crude or innuendo puns on the answer’s own words and numbers, if that makes it stick. Never slurs or anything hateful."
          />
          <div className="settings-sub">
            <p className="c-meta">You’ve confirmed you’re 18 or older.</p>
            <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={() => save('/age-confirmation', { adult: false })}>Remove my 18+ confirmation</button>
          </div>
        </>
      ) : (
        <>
          <p className="c-meta mts-note">Some memory-trick options are for adults. Confirm your age to see them.</p>
          <button type="button" className="c-btn c-btn--secondary mts-confirm" disabled={busy} onClick={() => save('/age-confirmation', { adult: true })}>I’m 18 or older</button>
        </>
      )}
      {error && <p className="retain-action-error" role="alert">{error}</p>}
      <style jsx>{`
        .mts-note { margin: 0; }
        .mts :global(.mts-confirm) { justify-self: start; }
      `}</style>
    </div>
  );
}
