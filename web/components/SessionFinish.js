import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import GroveTree from './GroveTree';
import { addGrowth, addRing, getProgress, groveKey } from '../lib/progress';
import { recordStudy } from '../lib/activity';

// The end of every session: the guide's tree gains a ring, plus three numbers.
export default function SessionFinish({ guideId, guideTitle, cards, accuracy, minutes, kind, onRestart, onDone, doneSpot, children }) {
  const [tree, setTree] = useState(null);

  useEffect(() => {
    recordStudy({ guideId, guideTitle, minutes, cards, right: Math.round((accuracy / 100) * cards), total: cards, kind });
    if (guideId) addGrowth(guideId, minutes);
    const rings = guideId ? addRing(guideId) : 0;
    const key = groveKey(guideId);
    setTree({ minutes: getProgress().grove[key] || minutes, rings });
  }, []);

  return (
    <section className="c-card finish" aria-labelledby="finish-title">
      {tree && <GroveTree minutes={tree.minutes} rings={Math.max(1, tree.rings)} newRing size={132} title="Your tree grew a ring" />}
      <h2 id="finish-title" className="c-title">Done</h2>
      <ul className="finish-stats">
        <li><strong>{cards}</strong><span>cards</span></li>
        <li><strong>{Math.round(accuracy)}%</strong><span>accuracy</span></li>
        <li><strong>{Math.max(1, Math.round(minutes))}</strong><span>min</span></li>
      </ul>
      {children}
      <div className="c-row finish-actions">
        {onRestart && <button type="button" className="c-btn c-btn--secondary" onClick={onRestart}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Restart</button>}
        <button type="button" className="c-btn c-btn--primary" data-spot={doneSpot} onClick={onDone}>Done</button>
      </div>
      <style jsx>{`
        .finish { display: grid; justify-items: center; gap: 16px; padding: 32px 24px; text-align: center; }
        .finish-stats { list-style: none; margin: 0; padding: 0; display: flex; gap: 40px; }
        .finish-stats li { display: grid; gap: 4px; }
        .finish-stats strong { font: 600 32px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .finish-actions { justify-content: center; flex-wrap: wrap; }
        @media (max-width: 767px) { .finish-stats { gap: 24px; } }
      `}</style>
    </section>
  );
}
