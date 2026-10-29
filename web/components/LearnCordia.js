import { useRouter } from 'next/router';
import { Check } from 'lucide-react';
import { useProgress } from '../lib/progress';
import { FEATURE_GROUPS, FEATURE_LIST } from '../lib/features';
import { showMe } from '../lib/showMe';
import { openHelp } from '../lib/help';

const NEXT_COUNT = 6;

// Every feature with a "Show me". Items tick themselves from real use. `compact` (Today's
// first week) shows only the next few not yet used, with a link to the full list.
export default function LearnCordia({ onBeforeShow, hideWhenComplete = false, compact = false }) {
  const router = useRouter();
  const progress = useProgress();
  const done = FEATURE_LIST.filter(item => progress.used.includes(item.id)).length;
  if (hideWhenComplete && done === FEATURE_LIST.length) return null;

  const groups = compact
    ? [{ label: '', items: FEATURE_LIST.filter(item => !progress.used.includes(item.id)).slice(0, NEXT_COUNT) }]
    : FEATURE_GROUPS;

  return (
    <section className="c-card learn" aria-labelledby="learn-title">
      <header className="c-row">
        <h2 id="learn-title" className="c-section-title">Learn Cordia</h2>
        <span className="c-meta">{done} of {FEATURE_LIST.length}</span>
      </header>
      {groups.map(group => (
        <div key={group.label || 'next'} className="learn-group">
          {group.label && <h3 className="learn-group-title">{group.label}</h3>}
          <ul className="learn-list">
            {group.items.map(item => {
              const used = progress.used.includes(item.id);
              return (
                <li key={item.id} className={used ? 'is-used' : ''}>
                  <span className="learn-icon" aria-hidden="true">{used ? <Check size={18} strokeWidth={2} /> : <item.icon size={20} strokeWidth={1.75} />}</span>
                  <span className="learn-label">{item.label}</span>
                  <button type="button" className="c-btn c-btn--quiet" onClick={async () => { onBeforeShow?.(); await showMe(router, item.id); }} aria-label={`Show me ${item.label}`}>Show me</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {compact && <button type="button" className="c-btn c-btn--quiet learn-all" onClick={() => { onBeforeShow?.(); openHelp(); }}>See all {FEATURE_LIST.length}</button>}
      <style jsx>{`
        .learn { display: grid; gap: 8px; padding: 20px; }
        .learn-group { display: grid; gap: 4px; }
        .learn-group + .learn-group { margin-top: 12px; }
        .learn-group-title { margin: 0; font: 600 13px/1.4 var(--font-sans); letter-spacing: 0; color: var(--muted); }
        .learn-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; }
        .learn-list li { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid var(--line); }
        .learn-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius:50%; background: var(--olive-tint); color: var(--olive-ink); }
        .is-used .learn-icon { background: var(--olive); color: var(--on-olive); }
        .learn-label { flex: 1; min-width: 0; font-weight:600; }
        .learn :global(.learn-all) { justify-self: start; }
        @media (max-width: 767px) { .learn-list { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
