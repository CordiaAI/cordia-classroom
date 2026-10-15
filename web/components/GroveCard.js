import Link from 'next/link';
import GroveTree, { STAGES, groveStage, nextStageLabel } from './GroveTree';
import { groveKey, useProgress } from '../lib/progress';
import { walkthroughEvent } from '../lib/walkthrough';

// Today's Grove row: the largest tree (48px), how far to its next stage, Open.
export default function GroveCard({ guides }) {
  const progress = useProgress();
  if (!guides.length) return null;
  const top = guides.map(guide => ({ guide, minutes: progress.grove[groveKey(guide.id)] || 0 })).sort((a, b) => b.minutes - a.minutes)[0];
  const stage = STAGES[groveStage(top.minutes)].name;
  return (
    <section className="c-card grove-row" aria-label="Grove" data-spot="grove">
      <GroveTree minutes={top.minutes} size={48} title={`${top.guide.title}, ${stage}`} />
      <span className="grove-row-text">
        <span className="c-section-title">Grove</span>
        <span className="c-meta">{nextStageLabel(top.minutes) || stage}</span>
      </span>
      <Link href="/grove" className="c-btn c-btn--secondary" onClick={() => walkthroughEvent('grove-opened')}>Open</Link>
      <style jsx global>{`
        .grove-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px 12px 12px; min-width: 0; }
        .grove-row-text { flex: 1; display: grid; gap: 2px; min-width: 0; }
        .grove-row-text .c-section-title { margin: 0; }
      `}</style>
    </section>
  );
}
