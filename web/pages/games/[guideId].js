import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, Blocks, Timer } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { GAMES_ON } from '../../lib/featureFlags';
import { walkthroughEvent } from '../../lib/walkthrough';

// Games for one guide, as tiles like Connectors: each one is played with the guide's cards.
export default function GuideGames() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [title, setTitle] = useState('');

  // Games aren't on for students yet (lib/features.js): back to the guide.
  useEffect(() => { if (!GAMES_ON && router.isReady) router.replace(guideId ? '/guide/' + guideId : '/library'); }, [router.isReady, guideId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId).then(data => setTitle(data?.guide?.title || ''));
  }, [ready, guideId]);

  if (!GAMES_ON || !ready || !guideId) return null;
  const games = [
    { key: 'blocks', name: 'Blocks', tag: 'Answer cards to earn pieces, then clear rows and columns.', icon: Blocks, href: `/play/${guideId}` },
    { key: 'match', name: 'Match', tag: 'Pair questions with answers in 60 seconds.', icon: Timer, href: `/quiz/${guideId}?mode=match`, event: 'match-opened' },
  ];
  return (
    <div className="games fade-in">
      <header className="c-page-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push('/guide/' + guideId)} aria-label="Back to the guide"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <div>
            <h1 className="c-title">Games</h1>
            {title && <p className="c-meta games-sub">{title}</p>}
          </div>
        </div>
      </header>
      <ul className="cn-grid games-grid">
        {games.map(game => (
          <li key={game.key}>
            <Link className="cn-tile" href={game.href} onClick={game.event ? () => walkthroughEvent(game.event) : undefined}>
              <span className="cn-icon is-lg"><game.icon strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="cn-tile-text">
                <span className="cn-name">{game.name}</span>
                <span className="c-meta games-tag">{game.tag}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <style jsx>{`
        .games { display: grid; gap: 16px; }
        .games-sub { margin: 2px 0 0; }
        .games-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
        .games :global(.cn-tile) { text-decoration: none; }
        .games :global(.cn-icon.is-lg svg) { width: 34px; height: 34px; }
        .games-tag { display: block; margin-top: 4px; font-size: 13px; line-height: 1.4; }
      `}</style>
    </div>
  );
}
