import { useCallback, useEffect, useState } from 'react';
import CordiaLoader, { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import FlashcardViewer from '../../components/FlashcardViewer';
import { walkthroughEvent } from '../../lib/walkthrough';
import { applyResults } from '../../lib/spacedReview.mjs';
import { saveStudyResults } from '../../lib/progressSave';
import { needsStudySet } from '../../lib/studySet.mjs';
import { makeStudySet } from '../../lib/autoStudySet';
import { loadStudyGuide } from '../../lib/studyGuide';
import UpdateAvailable, { GuideUnavailable } from '../../components/UpdateAvailable';


export default function FlashcardStudy() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [gone, setGone] = useState(null);
  const [reload, setReload] = useState(0);
  const gate = useLoadGate(Boolean(guide) || Boolean(error) || Boolean(gone) || making);
  // Someone else's shared guide (Stage 4): your own progress, and no owner actions.
  const viewer = guide?.viewer || null;

  useEffect(() => {
    if (!ready || !guideId) return;
    loadStudyGuide(guideId, 'cards').then(async data => {
      if (data?.unavailable) { setGone(data); return; }
      if (!data?.guide) { setError('These cards could not be loaded.'); return; }
      // No cards yet: notes without questions (a Canvas import) get them made first (your own guides).
      if (!data.guide.viewer && !(data.guide.flashcards || []).length) {
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
  }, [ready, guideId, reload]);

  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const cards = guide?.flashcards || [];
    // Merged into what was saved before, so one round never erases earlier progress.
    const progress = applyResults(guide?.flashcard_progress, { known, missed });
    setGuide(current => ({ ...current, flashcard_progress: progress }));
    await Promise.all([
      saveStudyResults(guideId, guide?.flashcard_progress, { known, missed }, null, guide?.viewer).then(saved => {
        if (guide?.viewer && saved) setGuide(current => ({ ...current, flashcard_progress: saved }));
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

  const goBack = () => router.push((viewer ? '/sets/' : '/guide/') + guideId);

  if (gone) return <GuideUnavailable title={gone.title} reason={gone.unavailable} />;
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
    {viewer && <UpdateAvailable guideId={guideId} viewer={viewer} onChanged={() => setReload(n => n + 1)} />}
    <FlashcardViewer
      key={viewer ? `v${viewer.version}` : 'own'}
      flashcards={guide.flashcards}
      guideId={guideId}
      logMode="flashcards"
      title={guide.title}
      starred={guide.is_bookmarked}
      onToggleStar={viewer ? undefined : toggleStar}
      onEdit={viewer ? undefined : () => router.push('/create?editGuideId=' + guideId)}
      onBack={goBack}
      onFinish={onFinish}
    />
    </Reveal>
  );
}
