import BodyPortal from './BodyPortal';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, ClipboardPaste, Copy, ExternalLink, KeyRound, X } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../lib/api';
import { canvasHost, schoolPolicy, termEndDate } from '../lib/canvas';
import CanvasCourseList from './CanvasCourseList';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function CopyValue({ label, value, children }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the value is visible to type */ }
  }
  return (
    <div className="ccs-value">
      <span className="c-meta">{label}</span>
      {children || <strong>{value}</strong>}
      <button type="button" className="c-icon-btn" onClick={copy} aria-label={`Copy ${label}`}>{copied ? <Check {...ICON} /> : <Copy {...ICON} />}</button>
    </div>
  );
}

// Token connect: Open Canvas, New token, Paste here. Then pick classes to import.
export default function CanvasConnectSheet({ school = '', initialDomain = '', onClose, onConnected }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialDomain);
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState(termEndDate());
  const [understood, setUnderstood] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const urlRef = useRef(null);
  const host = canvasHost(url);

  useEffect(() => {
    if (initialDomain || !school) return;
    schoolPolicy({ school }).then(policy => {
      if (policy.domain) setUrl(current => current || policy.domain);
      if (policy.tokens_allowed === false) setBlocked(true);
    });
  }, [school, initialDomain]);

  useEffect(() => {
    if (!host) return undefined;
    const timer = setTimeout(() => schoolPolicy({ domain: host }).then(policy => setBlocked(policy.tokens_allowed === false)), 300);
    return () => clearTimeout(timer);
  }, [host]);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function openCanvas() {
    if (!host) { urlRef.current?.focus(); return; }
    window.open(`https://${host}/profile/settings`, '_blank', 'noopener,noreferrer');
  }

  async function connect(event) {
    event.preventDefault();
    if (!host || !token.trim() || !understood || busy) return;
    setBusy(true);
    setError('');
    const data = await apiFetch('/canvas/connect', {
      method: 'POST',
      body: JSON.stringify({ canvas_url: host, token: token.trim(), expires_at: expires || null, acknowledged: understood }),
    });
    setToken('');
    setBusy(false);
    if (data?.connected) {
      setStatus(data);
      onConnected?.(data);
    } else if (data?.detail === "Your school doesn't allow tokens") {
      setBlocked(true);
    } else {
      setError(apiErrorMessage(data?.detail, "Canvas didn't accept that token."));
    }
  }

  return (
    <BodyPortal>
    <div className="c-scrim" onClick={onClose}>
      <section className="c-sheet ccs" role="dialog" aria-modal="true" aria-labelledby="ccs-title" onClick={event => event.stopPropagation()}>
        <header className="c-sheet-head">
          <h2 id="ccs-title" className="c-section-title ccs-title">{status ? 'Your classes' : 'Connect Canvas'}</h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X {...ICON} /></button>
        </header>

        {status ? (
          <>
            <CanvasCourseList courses={status.courses} onChange={next => { setStatus(next); onConnected?.(next); }} />
            <div className="ccs-actions"><button type="button" className="c-btn c-btn--primary" onClick={onClose}>Done</button></div>
          </>
        ) : blocked ? (
          <div className="ccs-blocked">
            <p className="ccs-line" role="status">Your school doesn't allow tokens</p>
            <button type="button" className="c-btn c-btn--primary" onClick={() => { onClose(); router.push('/calendar'); }}>Use Calendar feed</button>
          </div>
        ) : (
          <form className="ccs-form" onSubmit={connect}>
            <ol className="c-steps">
              <li className="c-step">
                <span className="c-step-num" aria-hidden="true">1</span>
                <h3 className="c-step-title"><ExternalLink {...ICON} />Open Canvas</h3>
                <div className="c-step-body">
                  <button type="button" className="c-btn c-btn--secondary ccs-step-btn" onClick={openCanvas}>Open settings</button>
                </div>
              </li>
              <li className="c-step">
                <span className="c-step-num" aria-hidden="true">2</span>
                <h3 className="c-step-title"><KeyRound {...ICON} />New token</h3>
                <div className="c-step-body">
                  <CopyValue label="Purpose" value="Cordia" />
                  <CopyValue label="Expires" value={expires}>
                    <input className="ccs-date" type="date" value={expires} onChange={event => setExpires(event.target.value)} aria-label="Expires" />
                  </CopyValue>
                </div>
              </li>
              <li className="c-step">
                <span className="c-step-num" aria-hidden="true">3</span>
                <h3 className="c-step-title"><ClipboardPaste {...ICON} />Paste here</h3>
                <div className="c-step-body">
                  <label className="c-field">
                    <span>Canvas URL</span>
                    <input ref={urlRef} className="c-input" value={url} onChange={event => setUrl(event.target.value)} placeholder="school.instructure.com" inputMode="url" autoComplete="off" spellCheck="false" />
                  </label>
                  <label className="c-field">
                    <span>Token</span>
                    <input className="c-input" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" spellCheck="false" />
                  </label>
                </div>
              </li>
            </ol>
            <p className="ccs-notice">Your token can do anything you can do in Canvas. Cordia only reads.</p>
            <label className="ccs-check">
              <input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} />
              <span>I understand</span>
            </label>
            {error && <p className="ccs-error" role="alert">{error}</p>}
            <button type="submit" className="c-btn c-btn--primary c-btn--block" disabled={!host || !token.trim() || !understood || busy}>{busy ? 'Connecting…' : 'Connect'}</button>
          </form>
        )}

        <style jsx global>{`
          .ccs { width: min(560px, 100%); display: grid; gap: 16px; }
          .ccs .c-sheet-head { margin-bottom: 0; }
          .ccs-title { margin: 0; font: 500 28px/1.1 var(--font-display); }
          .ccs-form { display: grid; gap: 16px; }
          .ccs-step-btn { justify-self: start; }
          .ccs-value { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 4px 0 14px; border-radius: 12px; background: var(--field); border: 1px solid var(--line); }
          .ccs-value .c-meta { min-width: 64px; }
          .ccs-date { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; color: var(--ink); font: 600 15px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
          .ccs-date:focus-visible { outline: 2px solid var(--olive); border-radius: 8px; }
          .ccs-value strong { flex: 1; font: 600 15px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
          .ccs-notice { margin: 0; font: 600 15px/1.45 var(--font-sans); color: var(--ink); }
          .ccs-check { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; font: 600 15px/1 var(--font-sans); cursor: pointer; }
          .ccs-check input { width: 20px; height: 20px; accent-color: var(--olive); }
          .ccs-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
          .ccs-blocked { display: grid; gap: 16px; justify-items: start; }
          .ccs-line { margin: 0; font: 600 17px/1.4 var(--font-sans); }
          .ccs-actions { display: flex; justify-content: flex-end; }
        `}</style>
      </section>
    </div>
    </BodyPortal>
  );
}
