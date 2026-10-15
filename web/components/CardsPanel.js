import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '../lib/api';
import { openNewSheet } from '../lib/newSheet';
import FlashcardViewer from './FlashcardViewer';

// Flashcards inside the guide shell.
export default function CardsPanel({ guide, onStar }) {
  const router = useRouter();
  const guideId = guide.id;

  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const cards = guide?.flashcards || [];
    await Promise.all([
      apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify({ known, unknown: missed, last_studied: new Date().toISOString() }) }),
      apiFetch('/stats/log-session', { method: 'POST', body: JSON.stringify({ guide_id: guideId, session_type: 'flashcard', duration_seconds: seconds, metadata: { cards_studied: cards.length, cards_correct: known.length } }) }),
    ]);
  }, [guide, guideId]);

  if (!guide.flashcards?.length) {
    return (
      <div className="c-empty">
        <span className="c-section-title">No cards</span>
        <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet('cards', { guideId })}>Make cards myself</button>
      </div>
    );
  }
  return (
    <FlashcardViewer
      flashcards={guide.flashcards}
      guideId={guideId}
      title={guide.title}
      starred={guide.is_bookmarked}
      onToggleStar={onStar}
      onEdit={() => openNewSheet('cards', { guideId })}
      onBack={() => router.push('/guide/' + guideId, undefined, { shallow: true })}
      onFinish={onFinish}
      embedded
    />
  );
}
