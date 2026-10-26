import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { canvasStatus } from '../lib/canvas';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { SETUP, TRY, connectHref } from '../lib/connectorGuide';

const HIDE_KEY = 'cordiaAppSetupHidden';

// On the Dashboard: the apps that make Cordia do the most, in order, each with what it gets the
// student. Connected ones say so and link to their first "Try it"; the rest go to their sheet in
// Settings › Connectors, which explains how to connect and what to do next. Hidden once all are
// connected, or when the student closes it.
export default function AppSetup({ canvasConnected = false }) {
  const [state, setState] = useState(null); // { connected: Set }
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (readUserValue(HIDE_KEY, false)) return undefined;
    setHidden(false);
    let live = true;
    Promise.all([apiFetch('/connectors'), canvasConnected ? null : canvasStatus()]).then(([apps, canvas]) => {
      if (!live) return;
      const connected = new Set((apps?.connectors || []).filter(app => app.connected).map(app => app.id));
      if (canvasConnected || canvas?.connected) connected.add('canvas');
      setState({ connected, loaded: Array.isArray(apps?.connectors) });
    });
    return () => { live = false; };
  }, [canvasConnected]);

  if (hidden || !state?.loaded) return null;
  const rows = SETUP.map(step => {
    const ids = step.any || [step.id];
    const on = ids.find(id => state.connected.has(id));
    return { ...step, on, first: on && TRY[on]?.find(item => item.href) };
  });
  const done = rows.filter(row => row.on).length;
  if (done === rows.length) return null;

  function hide() {
    writeUserValue(HIDE_KEY, true);
    setHidden(true);
  }

  return (
    <section className="c-card setup" aria-labelledby="setup-title">
      <header className="setup-head">
        <span className="c-grow">
          <h2 id="setup-title" className="c-section-title">Connect your apps</h2>
          <span className="c-meta">Cordia does the most with these. {done} of {rows.length} connected.</span>
        </span>
        <button type="button" className="c-icon-btn" onClick={hide} aria-label="Hide this">
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <ul className="setup-list">
        {rows.map(row => (
          <li key={row.id} className={row.on ? 'is-on' : ''}>
            <span className="setup-mark" aria-hidden="true">{row.on ? <Check size={16} strokeWidth={2.25} /> : null}</span>
            <span className="c-grow setup-text">
              <strong>{row.name}</strong>
              <span className="c-meta">{row.gets}</span>
            </span>
            {row.on
              ? row.first
                ? <Link href={row.first.href} className="c-btn c-btn--quiet c-btn--sm">{row.first.label}</Link>
                : <Link href={connectHref(row.on)} className="c-btn c-btn--quiet c-btn--sm">See how</Link>
              : <Link href={connectHref(row.any ? row.any[0] : row.id)} className="c-btn c-btn--secondary c-btn--sm">Connect</Link>}
          </li>
        ))}
      </ul>
      <style jsx>{`
        .setup { display: grid; gap: 8px; padding: 20px; }
        .setup-head { display: flex; align-items: flex-start; gap: 12px; }
        .setup-head .c-grow { display: grid; gap: 4px; }
        .setup-head .c-section-title { margin: 0; }
        .setup-list { list-style: none; margin: 0; padding: 0; display: grid; }
        .setup-list li { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 0; border-top: 1px solid var(--line); }
        .setup-mark { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--line); color: var(--on-olive); }
        .is-on .setup-mark { border-color: var(--olive); background: var(--olive); }
        .setup-text { flex: 1 1 auto; display: grid; gap: 2px; min-width: 0; }
        .setup-text strong { font: 600 15px/1.3 var(--font-sans); }
        .setup-text .c-meta { margin: 0; }
        .is-on .setup-text strong { color: var(--muted); }
        .setup-list :global(.c-btn) { flex: none; }
      `}</style>
    </section>
  );
}
