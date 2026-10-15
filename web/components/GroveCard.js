import { useRouter } from 'next/router';
import { TreeDeciduous } from 'lucide-react';
import GroveTree from './GroveTree';
import PulseDot from './PulseDot';
import { groveKey, useProgress } from '../lib/progress';
import { walkthroughEvent } from '../lib/walkthrough';

// Today's glimpse of the grove: one tree per recent guide.
export default function GroveCard({ guides, planting = false }) {
  const router = useRouter();
  const progress = useProgress();
  const recent = guides.slice(0, 6);
  if (!recent.length) return null;

  function open() {
    walkthroughEvent('grove-opened');
    router.push('/settings?section=grove');
  }

  return (
    <section className="c-card grove-card" aria-labelledby="grove-title" data-spot="grove">
      <header className="c-row">
        <TreeDeciduous size={20} strokeWidth={1.75} aria-hidden="true" />
        <h2 id="grove-title" className="c-section-title">Grove</h2>
        <PulseDot feature="grove" />
        <span className="c-spacer" />
        <button type="button" className="c-btn c-btn--quiet" onClick={open}>Open</button>
      </header>
      <ul className="grove-row">
        {recent.map((guide, index) => {
          const key = groveKey(guide.id);
          return (
            <li key={guide.id} className={planting && index === 0 ? 'is-planting' : ''} title={guide.title}>
              <GroveTree minutes={progress.grove[key] || 0} rings={progress.rings[key] || 0} size={72} title={guide.title} />
            </li>
          );
        })}
      </ul>
      <style jsx>{`
        .grove-card { display: grid; gap: 8px; padding: 16px 20px; }
        .grove-card :global(header > .lucide) { color: var(--olive-ink); }
        .grove-row { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; overflow-x: auto; }
        .grove-row li { flex: 0 0 auto; }
        .is-planting { animation: plant 900ms cubic-bezier(.34, 1.56, .64, 1) both; transform-origin: 50% 90%; }
        @keyframes plant { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .is-planting { animation: none; } }
      `}</style>
    </section>
  );
}
