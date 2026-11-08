import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import UserChip from './UserChip';
import { SectionLoader } from './CordiaLoader';
import { loadLeaderboard, setLeaderboard } from '../lib/socialActivity';

// The weekly friends leaderboard (Stage 10): effort this week (active study minutes and reviews),
// never quiz scores. Opt-in: you see it only after you join, it lists you and friends who joined,
// and you can leave any time. Never shown to students under 18 (the server says can_join: false).
export default function FriendsLeaderboard() {
  const [board, setBoard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() { loadLeaderboard().then(setBoard); }
  useEffect(load, []);

  async function change(joined) {
    setBusy(true);
    setError('');
    const result = await setLeaderboard(joined);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    load();
  }

  if (!board) return <SectionLoader height={96} label="Loading the leaderboard" />;
  if (board.error && !board.people) return null;  // before the server's update: say nothing
  if (!board.can_join) return null;

  return (
    <section className="c-card lb" aria-labelledby="lb-title">
      <div className="lb-head">
        <h2 id="lb-title" className="lb-title"><Trophy size={18} strokeWidth={1.75} aria-hidden="true" />This week with friends</h2>
        {board.joined && <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => change(false)} disabled={busy}>Leave</button>}
      </div>
      {!board.joined ? (
        <div className="lb-join">
          <p className="c-meta">See how much you and your friends studied this week: active minutes plus reviews. Never quiz scores. Only friends who join see it, and you can leave any time.</p>
          <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => change(true)} disabled={busy} aria-busy={busy}>{busy ? 'Joining…' : 'Join'}</button>
        </div>
      ) : (
        <>
          {board.people.length < 2 && <p className="c-meta lb-lone">None of your friends have joined yet. They’ll show here when they do.</p>}
          <ol className="lb-list">
            {board.people.map(person => (
              <li key={person.user_id} className={'lb-row' + (person.is_me ? ' is-me' : '')}>
                <span className="lb-rank" aria-label={`Rank ${person.rank}`}>{person.rank}</span>
                <span className="lb-who"><UserChip person={person} meta={person.is_me ? 'You' : ''} /></span>
                <span className="lb-numbers">
                  <strong>{person.points}</strong><span className="c-meta">{person.minutes} min · {person.reviews} {person.reviews === 1 ? 'review' : 'reviews'}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="c-meta lb-foot">Points are active study minutes plus reviews (an idea studied again on a later day). The week starts Monday.</p>
        </>
      )}
      {error && <p className="lb-error" role="alert">{error}</p>}
      <style jsx>{`
        .lb { display: grid; gap: 10px; padding: 16px; }
        .lb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .lb-title { display: flex; align-items: center; gap: 8px; margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .lb-title :global(svg) { color: var(--olive-ink); }
        .lb-join { display: grid; gap: 10px; justify-items: start; }
        .lb-join p, .lb-lone, .lb-foot { margin: 0; }
        .lb-list { display: grid; margin: 0; padding: 0; list-style: none; }
        .lb-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; min-width: 0; }
        .lb-row + .lb-row { border-top: 1px solid var(--hairline); }
        .lb-row.is-me .lb-rank { background: var(--olive-tint); color: var(--olive-ink); }
        .lb-rank { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 50%; color: var(--ink); font: 600 14px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .lb-who { flex: 1; min-width: 0; }
        .lb-numbers { display: grid; justify-items: end; gap: 2px; flex: none; text-align: right; }
        .lb-numbers strong { font: 600 18px/1 var(--font-sans); color: var(--ink); font-variant-numeric: tabular-nums; }
        .lb-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
      `}</style>
    </section>
  );
}
