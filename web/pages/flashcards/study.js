import { useCallback, useEffect, useState } from 'react';
import CordiaLoader, { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import FlashcardViewer from '../../components/FlashcardViewer';
import { walkthroughEvent } from '../../lib/walkthrough';
import { applyResults } from '../../lib/spacedReview.mjs';
import { needsStudySet } from '../../lib/studySet.mjs';
import { makeStudySet } from '../../lib/autoStudySet';


export default function FlashcardStudy() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const gate = useLoadGate(Boolean(guide) || Boolean(error) || making);

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId + '?fields=cards').then(async data => {
      if (!data?.guide) { setError('These cards could not be loaded.'); return; }
      // No cards yet: notes without questions (a Canvas import) get them made first.
      if (!(data.guide.flashcards || []).length) {
        const full = await apiFetch('/guides/' + guideId);
        if (full?.guide && needsStudySet(full.guide)) {
          setMaking(true);
          const made = await makeStudySet(full.guide);
          setMaking(false);
          if (made.error) { setError(made.error); return; }
          data = made;
        }
      }
      setGuide(data.guide);
      walkthroughEvent('cards-opened');
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
  if (making) return (
    <div className="cards-making" role="status">
      <CordiaLoader label="Making cards from your notes" /><p className="c-section-title">Making cards from your notes…</p>
      <style jsx>{`.cards-making { display: grid; justify-items: center; align-content: center; gap: 12px; min-height: calc(100vh - var(--bar-h) - 160px); } .cards-making p { margin: 0; }`}</style>
    </div>
  );
  if (!guide || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading cards" />;
  if (!guide.flashcards?.length) return <div className="c-empty"><p className="c-section-title">No cards</p><button type="button" className="c-btn c-btn--secondary" onClick={goBack}>Back</button></div>;

  return (
    <Reveal phase={gate}>
    {/* The page's heading for screen readers; the viewer shows the title in its bar. */}
    <h1 className="sr-only">Flashcards: {guide.title || 'Untitled guide'}</h1>
    <FlashcardViewer
      flashcards={guide.flashcards}
      guideId={guideId}
      logMode="flashcards"
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
