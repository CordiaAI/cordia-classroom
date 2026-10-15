import GroveTree from './GroveTree';
import { groveKey, useProgress } from '../lib/progress';
import { cleanTitle, looksAutomatic } from '../lib/guideTitle';

// The semester's grove: one tree per guide made since the semester began.
export default function GroveGrid({ guides, since }) {
  const progress = useProgress();
  const list = guides.filter(guide => new Date(guide.created_at) >= since);
  return (
    <section className="c-card grove-grid" aria-labelledby="grove-grid-title" id="grove">
      <header className="c-row">
        <h2 id="grove-grid-title" className="c-section-title">Grove</h2>
        <span className="c-meta">{list.length} trees</span>
      </header>
      {list.length ? (
        <ul>
          {list.map(guide => {
            const key = groveKey(guide.id);
            const minutes = progress.grove[key] || 0;
            return (
              <li key={guide.id}>
                <GroveTree minutes={minutes} rings={progress.rings[key] || 0} size={96} title={`${guide.title}, ${Math.round(minutes)} minutes`} />
                <span className="grove-name" title={guide.title}>{looksAutomatic(guide.title) ? cleanTitle(guide.title) : guide.title}</span>
                <span className="c-meta">{Math.round(minutes)} min</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="c-meta">0 trees</p>}
      <style jsx>{`
        .grove-grid { display: grid; gap: 12px; padding: 20px; scroll-margin-top: calc(var(--bar-h) + 16px); }
        ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, 128px); justify-content: space-between; gap: 16px; }
        li { display: grid; justify-items: center; align-content: start; gap: 4px; width: 128px; text-align: center; min-width: 0; }
        .grove-name { width: 128px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font: 600 13px/1.3 var(--font-sans); color: var(--ink); }
      `}</style>
    </section>
  );
}
