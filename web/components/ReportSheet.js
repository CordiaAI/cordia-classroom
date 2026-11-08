import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { TARGET_NAMES, reasonsFor, reportUnavailable } from '../lib/reportReasons.mjs';

// Report a guide, a profile or a classroom (social plan, Stage 9): pick a reason, send, and see a
// plain confirmation. Three different people reporting the same thing hide it until an admin looks
// (backend services/reports.py). Before the server's database update, onUnavailable() lets the page
// offer Send feedback instead, as before.
export default function ReportSheet({ targetType, targetId, name, onClose, onUnavailable }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const sheetRef = useRef(null);
  const what = TARGET_NAMES[targetType] || 'item';

  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function send(event) {
    event.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError('');
    const data = await apiFetch('/reports', { method: 'POST', reportFailure: true, body: JSON.stringify({ target_type: targetType, target_id: targetId, reason }) });
    setBusy(false);
    if (data?.ok) { setDone(true); return; }
    if (reportUnavailable(data?.detail) && onUnavailable) { onUnavailable(); return; }
    setError(apiErrorMessage(data?.detail, 'Couldn’t send your report. Try again.'));
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={() => !busy && onClose()}>
        <section ref={sheetRef} tabIndex={-1} className="c-sheet rs" role="dialog" aria-modal="true" aria-labelledby="rs-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="rs-title" className="c-title rs-title">{done ? 'Thanks for telling us' : `Report this ${what}`}</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          {done ? (
            <div className="rs-done" role="status">
              <span className="rs-done-icon" aria-hidden="true"><Check size={22} strokeWidth={2} /></span>
              <p>We’ll review {name ? <strong>{name}</strong> : `this ${what}`}. It isn’t told who reported it.</p>
              <div className="rs-actions"><button type="button" className="c-btn c-btn--primary" onClick={onClose}>Done</button></div>
            </div>
          ) : (
            <form className="rs-form" onSubmit={send}>
              {name && <p className="c-meta rs-lead">{name}</p>}
              <fieldset className="rs-reasons">
                <legend className="rs-legend">What’s wrong?</legend>
                {reasonsFor(targetType).map(item => (
                  <label key={item.key} className={'rs-option' + (reason === item.key ? ' is-on' : '')}>
                    <input type="radio" name="rs-reason" value={item.key} checked={reason === item.key} onChange={() => setReason(item.key)} disabled={busy} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="c-meta rs-note">If three people report the same {what}, it’s hidden until we review it.</p>
              {error && <p className="rs-error" role="alert">{error}</p>}
              <div className="rs-actions">
                <button type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="c-btn c-btn--primary" disabled={busy || !reason} aria-busy={busy}>{busy ? 'Sending…' : 'Send report'}</button>
              </div>
            </form>
          )}
          <style jsx>{`
            .rs { width: min(480px, 100%); display: grid; gap: 14px; }
            .rs-title { margin: 0; }
            .rs-form { display: grid; gap: 12px; }
            .rs-lead, .rs-note { margin: 0; overflow-wrap: anywhere; }
            .rs-reasons { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
            .rs-legend { margin-bottom: 6px; padding: 0; font: 600 13px/1.3 var(--font-sans); color: var(--muted-ink); }
            .rs-option { display: flex; gap: 12px; align-items: center; min-height: 44px; padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--r-input); cursor: pointer; color: var(--ink); font: 500 15px/1.35 var(--font-sans); }
            .rs-option.is-on { border-color: var(--olive); background: var(--olive-tint); color: var(--olive-ink); font-weight: 600; }
            .rs-option input { margin: 0; accent-color: var(--olive); flex: none; }
            .rs-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
            .rs-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
            .rs-done { display: grid; gap: 10px; justify-items: start; }
            .rs-done p { margin: 0; overflow-wrap: anywhere; }
            .rs-done-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
            .rs-done .rs-actions { justify-self: stretch; }
          `}</style>
        </section>
      </div>
    </BodyPortal>
  );
}
