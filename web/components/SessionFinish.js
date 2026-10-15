import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import GroveTree, { STAGES, groveStage } from './GroveTree';
import { addGrowth, getProgress, groveKey } from '../lib/progress';
import { recordStudy } from '../lib/activity';
import { apiFetch } from '../lib/api';
import { canvasKnownAvailable } from '../lib/canvas';

// One finish card for every session: the guide's tree (a new stage when earned) and
// three numbers. A soft fade; no confetti.
export default function SessionFinish({ guideId, guideTitle, cards, accuracy, minutes, kind, onRestart, onDone, doneSpot, children }) {
  const [tree, setTree] = useState(null);

  useEffect(() => {
    recordStudy({ guideId, guideTitle, minutes, cards, right: Math.round((accuracy / 100) * cards), total: cards, kind });
    const key = groveKey(guideId);
    const before = getProgress().grove[key] || 0;
    if (guideId) addGrowth(guideId, minutes);
    // Saved class sets count you as a studier (ranking only); other guides no-op on the server.
    if (guideId && canvasKnownAvailable() !== false) apiFetch(`/sharing/guides/${guideId}/studied`, { method: 'POST', body: JSON.stringify({ accuracy: Math.round(accuracy) }) });
    const after = guideId ? before + minutes : 0;
    setTree({ minutes: after, grew: groveStage(after) > groveStage(before) });
  }, []);

  return (
    <section className="c-card finish" aria-labelledby="finish-title">
      {tree && guideId && (
        <div className="finish-tree">
          <GroveTree minutes={tree.minutes} size={120} grow={tree.grew} />
          {tree.grew && <span className="c-meta" role="status">{STAGES[groveStage(tree.minutes)].name}</span>}
        </div>
      )}
      <h2 id="finish-title" className="finish-title">Done</h2>
      <dl className="finish-stats">
        <div><dt>cards</dt><dd>{cards}</dd></div>
        <div><dt>accuracy</dt><dd>{Math.round(accuracy)}%</dd></div>
        <div><dt>min</dt><dd>{Math.max(1, Math.round(minutes))}</dd></div>
      </dl>
      {children}
      <div className="finish-actions">
        {onRestart && <button type="button" className="c-btn c-btn--secondary" onClick={onRestart}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Restart</button>}
        <button type="button" className="c-btn c-btn--primary" data-spot={doneSpot} onClick={onDone}>Done</button>
      </div>
      <style jsx>{`
        .finish { display: grid; justify-items: center; gap: 16px; padding: 40px 24px; text-align: center; animation: finish-in 200ms ease-out both; }
        .finish-tree { display: grid; justify-items: center; gap: 4px; }
        .finish-title { margin: 0; font: 500 40px/1.08 var(--font-display); letter-spacing: -0.02em; }
        .finish-stats { display: flex; gap: 40px; margin: 0; }
        .finish-stats div { display: flex; flex-direction: column-reverse; gap: 4px; }
        .finish-stats dt { font: 500 15px/1 var(--font-sans); }
        .finish-stats dd { margin: 0; font: 600 32px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .finish-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
        @keyframes finish-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .finish { animation: none; } }
        @media (max-width: 767px) { .finish-stats { gap: 24px; } }
      `}</style>
    </section>
  );
}
