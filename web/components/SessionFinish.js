import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { addGrowth, addRing } from '../lib/progress';
import { recordStudy } from '../lib/activity';
import { apiFetch } from '../lib/api';
import { canvasKnownAvailable } from '../lib/canvas';

// The end of every session: three numbers and what to do next. (Study time per guide is still
// recorded for the Progress page; the grove of trees is hidden for now.)
export default function SessionFinish({ guideId, guideTitle, cards, accuracy, minutes, kind, onRestart, onDone, doneSpot, children }) {
  useEffect(() => {
    recordStudy({ guideId, guideTitle, minutes, cards, right: Math.round((accuracy / 100) * cards), total: cards, kind });
    if (guideId) addGrowth(guideId, minutes);
    // Saved class sets count you as a studier (ranking only); other guides no-op on the server.
    if (guideId && canvasKnownAvailable() !== false) apiFetch(`/sharing/guides/${guideId}/studied`, { method: 'POST', body: JSON.stringify({ accuracy: Math.round(accuracy) }) });
    if (guideId) addRing(guideId);
  }, []);

  return (
    <section className="c-card finish" aria-labelledby="finish-title">
      <h2 id="finish-title" className="c-title">Done</h2>
      <ul className="finish-stats">
        <li><strong>{cards}</strong><span>cards</span></li>
        <li><strong>{Math.round(accuracy)}%</strong><span>accuracy</span></li>
        <li><strong>{Math.max(1, Math.round(minutes))}</strong><span>min</span></li>
      </ul>
      {/* Spacing works better than it feels, so say what happens next. */}
      <p className="c-meta finish-next">{accuracy < 100 ? 'Study this guide again soon to lock in the ones you missed.' : 'All known. A quick review in a few days keeps it that way.'}</p>
      {children}
      <div className="c-row finish-actions">
        {onRestart && <button type="button" className="c-btn c-btn--secondary" onClick={onRestart}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Restart</button>}
        <button type="button" className="c-btn c-btn--primary" data-spot={doneSpot} onClick={onDone}>Done</button>
      </div>
      <style jsx>{`
        .finish { display: grid; justify-items: center; gap: 16px; padding: 32px 24px; text-align: center; }
        .finish-next { margin: 0; font-size: 15px; }
        .finish-stats { list-style: none; margin: 0; padding: 0; display: flex; gap: 40px; }
        .finish-stats li { display: grid; gap: 4px; }
        .finish-stats strong { font:600 28px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .finish-actions { justify-content: center; flex-wrap: wrap; }
        @media (max-width: 767px) { .finish-stats { gap: 24px; } }
      `}</style>
    </section>
  );
}
