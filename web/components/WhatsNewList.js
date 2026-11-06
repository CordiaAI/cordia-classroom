import { releaseIcon } from './WhatsNew';

const shortDate = value => {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

// The Notifications panel's "What's new" (components/NotificationBell.js): every released feature
// this student can use, newest first. A dot marks the ones that are new since they last looked.
export function WhatsNewList({ items, onShow }) {
  if (!items?.length) return null;
  return (
    <section className="wnl" aria-labelledby="wnl-title">
      <h3 id="wnl-title" className="wnl-head">What&rsquo;s new</h3>
      <ul className="wnl-list">
        {items.map(item => {
          const Icon = releaseIcon(item.icon);
          return (
            <li key={item.id} className={'wnl-row' + (item.isNew ? ' is-new' : '')}>
              <span className="wnl-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
              <span className="wnl-main">
                <span className="wnl-title">
                  {item.title}
                  {item.isNew && <><span className="wnl-dot" aria-hidden="true" /><span className="sr-only"> (new)</span></>}
                </span>
                <span className="wnl-text">{item.description}</span>
                <span className="wnl-foot">
                  <span className="c-meta wnl-date">{shortDate(item.releasedAt)}</span>
                  <button type="button" className="wnl-show" aria-label={`Show me ${item.title}`} onClick={() => onShow(item)}>Show me</button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <style jsx>{`
        .wnl { display: grid; gap: 2px; }
        .wnl-head { margin: 4px 8px 2px; font: 600 13px/1.3 var(--font-sans); color: var(--muted-ink); }
        .wnl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
        .wnl-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 10px; padding: 10px 8px; border-radius: var(--r-input); }
        .wnl-row.is-new { background: var(--olive-tint); }
        .wnl-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .wnl-row.is-new .wnl-icon { background: var(--card); }
        .wnl-main { display: grid; gap: 2px; min-width: 0; }
        .wnl-title { font: 600 15px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
        .wnl-dot { display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%; background: var(--olive); vertical-align: middle; }
        .wnl-text { font: 500 14px/1.35 var(--font-sans); color: var(--muted-ink); overflow-wrap: anywhere; }
        .wnl-foot { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
        .wnl-date { font-size: 12px; }
        .wnl-show { min-height: 32px; padding: 0 2px; border: 0; background: none; color: var(--olive-ink); font: 600 14px/1 var(--font-sans); cursor: pointer; }
        .wnl-show:hover { text-decoration: underline; }
      `}</style>
    </section>
  );
}
