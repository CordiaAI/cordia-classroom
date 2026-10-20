import { CalendarCheck, Puzzle } from 'lucide-react';
import BodyPortal from './BodyPortal';
import CanvasConnectButton from './CanvasConnectButton';
import { EXTENSION_STORE_URL } from '../lib/extension';

// The last first-run screen: a reason to come back tomorrow, and two optional next steps.
export default function FirstReview({ onDone }) {
  const installed = typeof document !== 'undefined' && document.documentElement.getAttribute('data-asai-extension') === 'ready';
  return (
    <BodyPortal>
      <div className="c-scrim">
        <section className="c-sheet first-review" role="dialog" aria-modal="true" aria-labelledby="first-review-title">
          <CalendarCheck size={32} strokeWidth={1.75} aria-hidden="true" />
          <h1 id="first-review-title" className="c-title">Your first review is tomorrow</h1>
          <p className="c-meta">A few minutes on Today each day keeps what you learned. Cordia lines the cards up for you.</p>
          <div className="first-review-options">
            <CanvasConnectButton className="c-btn c-btn--secondary" />
            {!installed && <a className="c-btn c-btn--secondary" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer"><Puzzle size={20} strokeWidth={1.75} aria-hidden="true" />Get the Chrome extension</a>}
          </div>
          <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={onDone} autoFocus>Done</button>
        </section>
      </div>
      <style jsx>{`
        .first-review { display: grid; justify-items: center; gap: 16px; width: min(520px, 100%); text-align: center; }
        .first-review > :global(.lucide) { color: var(--olive-ink); }
        .first-review p, .first-review h1 { margin: 0; }
        .first-review-options { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
      `}</style>
    </BodyPortal>
  );
}
