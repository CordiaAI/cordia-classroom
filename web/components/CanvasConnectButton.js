import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { canvasStatus } from '../lib/canvas';
import { markUsed } from '../lib/progress';
import { walkthroughEvent } from '../lib/walkthrough';
import CanvasConnectSheet from './CanvasConnectSheet';

// "Connect Canvas" wherever classes or deadlines show. Hidden once connected, or on a
// backend without Canvas. `card` adds the one-line pitch for Today.
export default function CanvasConnectButton({ card = false, className = 'c-btn c-btn--quiet', spot }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    canvasStatus().then(data => {
      if (data?.connected) markUsed('canvas');
      if (live) setState(data ? { connected: Boolean(data.connected) } : null);
    });
    return () => { live = false; };
  }, []);

  if (!state || (state.connected && !open)) return null;

  function start() {
    setOpen(true);
    walkthroughEvent('canvas-opened');
  }

  function connected(data) {
    if (!data?.connected) return;
    setState({ connected: true });
    walkthroughEvent('canvas-connected');
  }

  const button = (
    <button type="button" className={className} onClick={start} data-spot={spot}>
      <Link2 size={20} strokeWidth={1.75} aria-hidden="true" />Connect Canvas
    </button>
  );
  const sheet = open && <CanvasConnectSheet school={localStorage.getItem('cordiaSchool') || ''} onClose={() => setOpen(false)} onConnected={connected} />;

  if (!card) return <>{state.connected ? null : button}{sheet}</>;
  return (
    <>
      {!state.connected && (
        <section className="c-glass canvas-card" aria-label="Canvas">
          <div className="canvas-card-text">
            <strong>Bring in Canvas</strong>
            <span className="c-meta">Your classes, files and deadlines, kept in sync.</span>
          </div>
          {button}
        </section>
      )}
      {sheet}
      <style jsx>{`
        .canvas-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-radius: var(--r-card); flex-wrap: wrap; }
        .canvas-card-text { display: grid; gap: 2px; min-width: 0; }
        .canvas-card-text strong { font: 600 17px/1.3 var(--font-sans); }
        @media (max-width: 767px) { .canvas-card :global(button) { width: 100%; justify-content: center; } }
      `}</style>
    </>
  );
}
