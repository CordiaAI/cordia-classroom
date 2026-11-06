import { useRouter } from 'next/router';
import { helpList } from '../lib/featureReleases';
import { useWhatsNew } from '../lib/whatsNew';
import { openRelease, releaseIcon } from './WhatsNew';

const shortDate = value => {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

// Help's "What's new": every released feature this student can use, newest first. A dot marks
// the ones they haven't tried or dismissed yet (the same dot sits on the Help menu item).
export function WhatsNewList({ onBeforeShow }) {
  const router = useRouter();
  const { ready, user, seen, releases, flags } = useWhatsNew();
  if (!ready) return null;
  const items = helpList(releases, user, seen, flags);
  if (!items.length) return null;
  return (
    <section className="c-card wnl" aria-labelledby="wnl-title">
      <h2 id="wnl-title" className="c-section-title">What&rsquo;s new</h2>
      <ul className="wnl-list">
        {items.map(item => {
          const Icon = releaseIcon(item.icon);
          return (
            <li key={item.id} className="wnl-row">
              <span className="wnl-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
              <span className="wnl-main">
                <span className="wnl-title">
                  {item.unseen && <span className="wnl-dot" aria-hidden="true" />}
                  {item.title}
                  {item.unseen && <span className="sr-only"> (new)</span>}
                </span>
                <span className="c-meta">{item.description}</span>
                <span className="c-meta wnl-date">{shortDate(item.releasedAt)}</span>
              </span>
              <button type="button" className="c-btn c-btn--quiet" aria-label={`Show me ${item.title}`}
                onClick={async () => { onBeforeShow?.(); await openRelease(router, item); }}>Show me</button>
            </li>
          );
        })}
      </ul>
      <style jsx>{`
        .wnl { display: grid; gap: 8px; padding: 20px; margin-bottom: 16px; box-shadow: none; }
        .wnl :global(.c-section-title) { margin: 0; }
        .wnl-list { list-style: none; margin: 0; padding: 0; display: grid; }
        .wnl-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); min-width: 0; }
        .wnl-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .wnl-main { display: grid; gap: 2px; flex: 1; min-width: 0; }
        .wnl-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
        .wnl-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--olive); }
        .wnl-date { font-size: 13px; }
      `}</style>
    </section>
  );
}
