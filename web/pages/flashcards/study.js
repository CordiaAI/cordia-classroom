import { useCallback, useEffect, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import FlashcardViewer from '../../components/FlashcardViewer';
import { walkthroughEvent } from '../../lib/walkthrough';
import { applyResults } from '../../lib/spacedReview.mjs';


export default function FlashcardStudy() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');
  const gate = useLoadGate(Boolean(guide) || Boolean(error));

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId + '?fields=cards').then(data => {
      if (data?.guide) { setGuide(data.guide); walkthroughEvent('cards-opened'); }
      else setError('These cards could not be loaded.');
    });
  }, [ready, guideId]);

  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const cards = guide?.flashcards || [];
    // Merged into what was saved before, so one round never erases earlier progress.
    const progress = applyResults(guide?.flashcard_progress, { known, missed });
    setGuide(current => ({ ...current, flashcard_progress: progress }));
    await Promise.all([
      apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify(progress) }),
      apiFetch('/stats/log-session', {
        method: 'POST',
        body: JSON.stringify({ guide_id: guideId, session_type: 'flashcard', duration_seconds: seconds, metadata: { cards_studied: cards.length, cards_correct: known.length } }),
      }),
    ]);
  }, [guide, guideId]);

  async function toggleStar() {
    setGuide(current => ({ ...current, is_bookmarked: !current.is_bookmarked }));
    const data = await apiFetch('/guides/' + guideId + '/bookmark', { method: 'PATCH' });
    if (data && typeof data.is_bookmarked === 'boolean') setGuide(current => ({ ...current, is_bookmarked: data.is_bookmarked }));
  }

  const goBack = () => router.push('/guide/' + guideId);

  if (error) return <div className="c-empty"><p className="c-section-title" role="alert">{error}</p><button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library?tab=cards')}>Back</button></div>;
  if (!guide || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading cards" />;
  if (!guide.flashcards?.length) return <div className="c-empty"><p className="c-section-title">No cards</p><button type="button" className="c-btn c-btn--secondary" onClick={goBack}>Back</button></div>;

  return (
    <Reveal phase={gate}>
    <FlashcardViewer
      flashcards={guide.flashcards}
      guideId={guideId}
      title={guide.title}
      starred={guide.is_bookmarked}
      onToggleStar={toggleStar}
      onEdit={() => router.push('/create?editGuideId=' + guideId)}
      onBack={goBack}
      onFinish={onFinish}
    />
    </Reveal>
  );
}
