import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Upload } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { cleanTitle, looksAutomatic } from '../lib/guideTitle';
import GroveTree, { STAGES, groveStage } from '../components/GroveTree';
import { groveKey, useProgress } from '../lib/progress';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';

// One tree per guide. Study minutes grow it; Focus pauses growth; trees never die.
export default function GrovePage() {
  const { ready } = useRequireAuth();
  const progress = useProgress();
  const [guides, setGuides] = useState(null);

  useEffect(() => {
    if (!ready) return;
    walkthroughEvent('grove-opened');
    apiFetch('/guides?fields=summary&limit=500').then(data => setGuides(Array.isArray(data?.guides) ? data.guides : []));
  }, [ready]);

  if (!ready) return null;
  return (
    <div className="c-page grove-page">
      <header className="c-page-head"><h1 className="c-title">Grove</h1></header>
      <ol className="grove-legend" aria-label="Stages">
        {STAGES.map(stage => (
          <li key={stage.name}>
            <GroveTree minutes={stage.minutes} size={44} title={stage.name} />
            <span>{stage.name}</span>
            <span className="c-meta">{stage.minutes} min</span>
          </li>
        ))}
      </ol>
      {!guides ? (
        <div className="grove-grid">{[0, 1, 2, 3].map(index => <div key={index} className="c-skeleton" style={{ height: 180, borderRadius: 20 }} />)}</div>
      ) : guides.length ? (
        <ul className="grove-grid">
          {guides.map(guide => {
            const minutes = progress.grove[groveKey(guide.id)] || 0;
            return (
              <li key={guide.id}>
                <Link href={'/guide/' + guide.id} className="grove-tile">
                  <GroveTree minutes={minutes} size={112} title={`${guide.title}, ${STAGES[groveStage(minutes)].name}`} />
                  <span className="grove-tile-title" title={guide.title}>{looksAutomatic(guide.title) ? cleanTitle(guide.title) : guide.title}</span>
                  <span className="c-meta">{STAGES[groveStage(minutes)].name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="c-empty">
          <GroveTree minutes={0} size={120} title="Seed" />
          <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}><Upload size={20} strokeWidth={1.75} aria-hidden="true" />Add material</button>
        </div>
      )}
      <style jsx global>{`
        .grove-legend { position: sticky; top: calc(var(--bar-h) + 8px); z-index: 5; list-style: none; margin: 0; padding: 8px 16px; display: flex; justify-content: space-between; gap: 8px; border-radius: 999px; background: var(--glass); -webkit-backdrop-filter: blur(28px) saturate(170%); backdrop-filter: blur(28px) saturate(170%); border: 1px solid var(--glass-edge); }
        .grove-legend li { display: flex; align-items: center; gap: 8px; font: 500 15px/1 var(--font-sans); }
        .grove-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px 16px; }
        .grove-tile { display: grid; justify-items: center; gap: 4px; padding: 16px 8px; border-radius: 20px; color: var(--ink); text-decoration: none; text-align: center; transition: background 160ms ease-out; }
        .grove-tile:hover { background: var(--hover); text-decoration: none; }
        .grove-tile-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; width: 100%; font: 600 15px/1.3 var(--font-display); }
        @media (max-width: 1023px) {
          .grove-legend { border-radius: 20px; flex-wrap: wrap; justify-content: center; top: 64px; }
          .grove-legend li .grove-tree { display: none; }
          .grove-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
    </div>
  );
}
