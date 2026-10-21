import { useEffect, useRef, useState } from 'react';
import BodyPortal from '../BodyPortal';
import { assistantApi } from '../../lib/assistant';

// Apple Calendar for Cordia Assistant: an Apple ID email and an app-specific password, sent to
// the Assistant (it reads the calendar over CalDAV to text heads-ups before events).
export default function IcloudSheet({ connector, onClose, onConnected }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    const out = await assistantApi(`/connections/${connector.id}`, { method: 'POST', json: { email, password } });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That didn't connect. Try again."); return; }
    onConnected(out.data);
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <form className="c-sheet asst-sheet" role="dialog" aria-modal="true" aria-labelledby="icloud-title" onClick={event => event.stopPropagation()} onSubmit={submit}>
          <h2 id="icloud-title" className="c-title">Connect {connector.name}</h2>
          <p>{connector.never}</p>
          <ol className="c-steps">
            {connector.steps.map((step, index) => (
              <li key={step} className="c-step">
                <span className="c-step-num" aria-hidden="true">{index + 1}</span>
                <p className="c-step-title">{step}</p>
              </li>
            ))}
          </ol>
          <label className="c-field"><span>Apple ID email</span><input ref={firstRef} className="c-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="c-field"><span>App-specific password</span><input className="c-input" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" value={password} onChange={event => setPassword(event.target.value)} /></label>
          {error && <p className="asst-error" role="alert">{error}</p>}
          <div className="asst-sheet-actions">
            <span className="c-grow" />
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="c-btn c-btn--primary" disabled={busy || !email || !password}>{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      </div>
    </BodyPortal>
  );
}
