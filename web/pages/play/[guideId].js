import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import BlockGame from '../../components/BlockGame';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { GAMES_ON } from '../../lib/featureFlags';
import { applyResults } from '../../lib/spacedReview.mjs';

// Blocks for one guide: its cards earn the pieces, and the answers count toward card review.
export default function PlayBlocks() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const gate = useLoadGate(Boolean(guide) || Boolean(error));

  // Games aren't on for students yet (lib/features.js): back to the guide.
  useEffect(() => { if (!GAMES_ON && router.isReady) router.replace(guideId ? '/guide/' + guideId : '/library'); }, [router.isReady, guideId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId).then(data => {
      if (data?.guide) setGuide(data.guide);
      else setError('This guide could not be loaded.');
    });
  }, [ready, guideId]);

  const onResults = useCallback(async ({ known, missed, seconds }) => {
    if (!guide || (!known.length && !missed.length)) return;
    // Same review schedule as Flashcards, merged into what was saved before.
    const progress = applyResults(guide.flashcard_progress, { known, missed });
    setGuide(current => ({ ...current, flashcard_progress: progress }));
    await Promise.all([
      apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify(progress) }),
      apiFetch('/stats/log-session', {
        method: 'POST',
        body: JSON.stringify({ guide_id: guideId, session_type: 'flashcard', duration_seconds: seconds, metadata: { game: 'blocks', cards_studied: known.length + missed.length, cards_correct: known.length } }),
      }),
    ]);
  }, [guide, guideId]);

  const back = () => router.push('/guide/' + guideId);

  if (!GAMES_ON) return null;
  if (error) return <div className="c-empty"><p className="c-section-title" role="alert">{error}</p><button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Back</button></div>;
  if (!guide || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading Blocks" />;

  return (
    <Reveal phase={gate}>
      <div className="play fade-in">
        <header className="c-page-head play-head">
          <div className="c-row">
            <button type="button" className="c-icon-btn" onClick={back} aria-label="Back to the guide"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
            <div>
              <h1 className="c-title">Blocks</h1>
              <p className="c-meta play-sub">{guide.title}</p>
            </div>
          </div>
        </header>
        <BlockGame key={round} guide={guide} onResults={onResults} onDone={what => (what === 'again' ? setRound(value => value + 1) : back())} />
      </div>
      <style jsx>{`
        .play { display: grid; gap: 16px; padding-bottom: 32px; }
        .play-head { margin-bottom: 0; }
        .play-sub { margin: 2px 0 0; }
      `}</style>
    </Reveal>
  );
}
