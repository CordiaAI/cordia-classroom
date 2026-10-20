import { useRouter } from 'next/router';
import { Check } from 'lucide-react';
import { useProgress } from '../lib/progress';
import { FEATURE_LIST } from '../lib/features';
import { showMe } from '../lib/showMe';

// Every feature with a "Show me". Items tick themselves from real use.
export default function LearnCordia({ onBeforeShow, hideWhenComplete = false }) {
  const router = useRouter();
  const progress = useProgress();
  const done = FEATURE_LIST.filter(item => progress.used.includes(item.id)).length;
  if (hideWhenComplete && done === FEATURE_LIST.length) return null;

  return (
    <section className="c-card learn" aria-labelledby="learn-title">
      <header className="c-row">
        <h2 id="learn-title" className="c-section-title">Learn Cordia</h2>
        <span className="c-meta">{done} of {FEATURE_LIST.length}</span>
      </header>
      <ul className="learn-list">
        {FEATURE_LIST.map(item => {
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
      <style jsx>{`
        .learn { display: grid; gap: 8px; padding: 20px; }
        .learn-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; }
        .learn-list li { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid var(--line); }
        .learn-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius:50%; background: var(--olive-tint); color: var(--olive-ink); }
        .is-used .learn-icon { background: var(--olive); color: var(--on-olive); }
        .learn-label { flex: 1; min-width: 0; font-weight:600; }
        @media (max-width: 767px) { .learn-list { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
