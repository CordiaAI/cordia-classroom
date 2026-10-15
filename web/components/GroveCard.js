import Link from 'next/link';
import GroveTree, { STAGES, groveStage, nextStageLabel } from './GroveTree';
import { groveKey, useProgress } from '../lib/progress';
import { walkthroughEvent } from '../lib/walkthrough';

// Today's glimpse of the grove: the tallest tree and how far to its next stage.
export default function GroveCard({ guides }) {
  const progress = useProgress();
  if (!guides.length) return null;
  const ranked = guides.map(guide => ({ guide, minutes: progress.grove[groveKey(guide.id)] || 0 })).sort((a, b) => b.minutes - a.minutes);
  const top = ranked[0];
  const next = nextStageLabel(top.minutes);
  return (
    <Link href="/grove" className="c-card grove-card" data-spot="grove" onClick={() => walkthroughEvent('grove-opened')}>
      <GroveTree minutes={top.minutes} size={88} title={`${top.guide.title}, ${STAGES[groveStage(top.minutes)].name}`} />
      <span className="grove-card-text">
        <span className="c-section-title">Grove</span>
        <span className="grove-card-guide c-truncate">{top.guide.title}</span>
        <span className="c-meta">{next || STAGES[groveStage(top.minutes)].name}</span>
      </span>
      <style jsx global>{`
        .grove-card { display: flex; align-items: center; gap: 16px; padding: 16px 24px 16px 16px; color: var(--ink); text-decoration: none; min-width: 0; }
        .grove-card:hover { text-decoration: none; }
        .grove-card-text { display: grid; gap: 4px; min-width: 0; }
        .grove-card-guide { font: 500 15px/1.3 var(--font-sans); }
      `}</style>
    </Link>
  );
}
