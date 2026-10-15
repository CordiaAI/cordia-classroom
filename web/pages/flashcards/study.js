import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import FlashcardViewer from '../../components/FlashcardViewer';
import { walkthroughEvent } from '../../lib/walkthrough';

function Skeleton() {
  return (
    <div className="fc-skeleton" aria-busy="true" aria-label="Loading cards">
      <div className="c-skeleton" style={{ height: 52, borderRadius: 999 }} />
      <div className="c-skeleton" style={{ height: 4 }} />
      <div className="c-skeleton" style={{ height: 340, borderRadius: 20 }} />
      <style jsx>{`.fc-skeleton { display: grid; gap: 20px; width: min(760px, 100%); margin: 0 auto; }`}</style>
    </div>
  );
}

export default function FlashcardStudy() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId).then(data => {
      if (data?.guide) { setGuide(data.guide); walkthroughEvent('cards-opened'); }
      else setError('These cards could not be loaded.');
    });
  }, [ready, guideId]);

  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const cards = guide?.flashcards || [];
    await Promise.all([
      apiFetch('/guides/' + guideId + '/flashcard-progress', {
        method: 'PATCH',
        body: JSON.stringify({ known, unknown: missed, last_studied: new Date().toISOString() }),
      }),
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
  if (!guide) return <Skeleton />;
  if (!guide.flashcards?.length) return <div className="c-empty"><p className="c-section-title">No cards</p><button type="button" className="c-btn c-btn--secondary" onClick={goBack}>Back</button></div>;

  return (
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
  );
}
