import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import UserChip from './UserChip';
import { SectionLoader } from './CordiaLoader';
import FriendsLeaderboard from './FriendsLeaderboard';
import { loadActivity } from '../lib/socialActivity';
import { activityLine, whenLabel } from '../lib/activityText.mjs';

// The Activity tab on /friends (Stage 10): new public guides from people you follow, guides added
// to your classrooms, and friends' streak milestones. No comments and no messages, by design.
export default function ActivityFeed() {
  const [feed, setFeed] = useState(null); // { items, next_cursor } | { failed }
  const [more, setMore] = useState(false);

  useEffect(() => { loadActivity().then(data => setFeed(data || { failed: true })); }, []);

  async function showMore() {
    setMore(true);
    const data = await loadActivity(feed.next_cursor);
    setMore(false);
    if (data) setFeed(current => ({ items: [...current.items, ...data.items], next_cursor: data.next_cursor }));
  }

  return (
    <>
      <FriendsLeaderboard />
      <section className="af" aria-labelledby="af-title">
        <h2 id="af-title" className="c-section-title">Lately</h2>
        {!feed && <SectionLoader height={160} label="Loading activity" />}
        {feed?.failed && <p className="c-card af-empty" role="alert">Couldn’t load activity. Try again in a moment.</p>}
        {feed?.items?.length === 0 && <p className="c-card af-empty">Nothing new yet. New public guides from people you follow, guides added to your classrooms and friends’ streaks show up here.</p>}
        {feed?.items?.length > 0 && (
          <ul className="c-card af-list">
            {feed.items.map((item, index) => {
              const line = activityLine(item);
              return (
                <li key={`${item.kind}:${item.at}:${index}`} className="af-item">
                  <UserChip person={item.actor} meta={whenLabel(item.at)} />
                  <p className="af-text">
                    {item.kind === 'streak' && <Flame size={16} strokeWidth={1.75} aria-hidden="true" />}
                    <span>{line.text}{line.link ? ': ' : '.'}</span>
                    {line.link && <Link href={line.link.href} className="af-link">{line.link.label}</Link>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {feed?.next_cursor && <button type="button" className="c-btn c-btn--secondary af-more" onClick={showMore} disabled={more} aria-busy={more}>{more ? 'Loading…' : 'Show more'}</button>}
      </section>
      <style jsx>{`
        .af { display: grid; gap: 10px; }
        .af h2 { margin: 0; }
        .af-empty { margin: 0; padding: 24px 20px; color: var(--muted); text-align: center; }
        .af-list { display: grid; margin: 0; padding: 6px 0; list-style: none; }
        .af-item { display: grid; gap: 6px; padding: 12px 16px; min-width: 0; }
        .af-item + .af-item { border-top: 1px solid var(--hairline); }
        .af-text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 0 0 52px; color: var(--ink); font: 500 15px/1.45 var(--font-sans); overflow-wrap: anywhere; }
        .af-text :global(svg) { color: var(--olive-ink); flex: none; }
        .af-text :global(.af-link) { color: var(--ink); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
        .af-more { justify-self: start; }
        @media (max-width: 480px) { .af-text { margin-left: 0; } }
      `}</style>
    </>
  );
}
