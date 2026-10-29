import { useCallback, useEffect, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PencilRuler } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { learnAfterReview, loadStudyQueue } from '../lib/studyQueue';
import { clearRetainMisses } from '../lib/userStore';
import { applyResults } from '../lib/spacedReview.mjs';
import FlashcardViewer from '../components/FlashcardViewer';

function PracticeList({ practice }) {
  if (!practice.length) return null;
  return (
    <div className="c-card c-list session-practice">
      {practice.map(item => (
        <div key={item.guideId} className="c-list-row">
          <PencilRuler size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="c-grow c-truncate">{item.guideTitle}</span>
          <span className="c-meta">{item.open} {item.open === 1 ? 'problem' : 'problems'}</span>
          <Link className="c-btn c-btn--primary" href={'/practice/' + item.guideId}>Practice</Link>
        </div>
      ))}
      <style jsx>{`.session-practice { width: 100%; text-align: left; }`}</style>
    </div>
  );
}

// Daily review: Retain misses, due flashcards and Learn ideas in one round (lib/studyQueue.js),
// then open practice problems. With ?guideId= it is that guide's Study now.
export default function StudySession() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [queue, setQueue] = useState(null);
  const gate = useLoadGate(Boolean(queue));

  useEffect(() => {
    if (!ready || !router.isReady) return;
    // ?guideId= is a guide's Study now: the same round, for that guide only.
    loadStudyQueue({ guideId: typeof router.query.guideId === 'string' ? router.query.guideId : '' }).then(setQueue);
  }, [ready, router.isReady]);

  const cards = queue ? queue.items : [];
  // Nothing to flip: Start goes straight into the first open practice set, not a menu.
  const directPractice = queue && !cards.length && queue.practice.length ? queue.practice[0].guideId : '';
  useEffect(() => {
    if (directPractice) router.replace('/practice/' + directPractice);
  }, [directPractice, router]);

  // Each answer is saved to every record its question came from (lib/studyQueue.js).
  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const knownSet = new Set(known);
    const missedSet = new Set(missed);
    const byGuide = new Map();
    cards.forEach((card, position) => {
      const right = knownSet.has(position);
      if (!right && !missedSet.has(position)) return;
      const entry = byGuide.get(card.guideId) || { known: [], unknown: [], learn: [], cleared: [] };
      if (card.index !== undefined) (right ? entry.known : entry.unknown).push(card.index);
      if (card.concept !== undefined) entry.learn.push({ concept: card.concept, known: right });
      if (card.miss && right) entry.cleared.push(card.front);
      byGuide.set(card.guideId, entry);
    });
    const requests = [...byGuide.entries()].map(async ([guideId, entry]) => {
      const guide = queue.guides.find(item => item.id === guideId);
      if (entry.cleared.length) clearRetainMisses(guideId, entry.cleared);
      // Known cards come back later, missed ones tomorrow (lib/spacedReview.mjs).
      if (entry.known.length || entry.unknown.length) {
        const next = applyResults(guide?.flashcard_progress, { known: entry.known, missed: entry.unknown });
        await apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify(next) });
      }
      // After the flashcard save: both read and rewrite flashcard_progress, so they must not overlap.
      const learn = learnAfterReview(guide, entry.learn);
      if (learn) await apiFetch('/guides/' + guideId + '/learn-progress', { method: 'PATCH', body: JSON.stringify(learn) });
    });
    requests.push(apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify({ session_type: 'flashcard', duration_seconds: seconds, metadata: { cards_studied: cards.length, cards_correct: known.length, mixed: true } }),
    }));
    await Promise.all(requests);
  }, [cards, queue]);

  if (!ready) return null;
  if (!queue || directPractice || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading your session" />;


  // Nothing to flip: say why, and offer the one next step (a bare "All done" explained nothing).
  if (!cards.length) {
    const guide = router.query.guideId ? queue.guides[0] : null;
    const title = queue.practice.length ? 'Practice' : guide ? 'Nothing to study yet' : 'All caught up';
    return (
      <div className="c-page session-empty">
        <h1 className="c-title">{title}</h1>
        {!queue.practice.length && (
          <p className="c-meta session-empty-why">
            {guide
              ? `${guide.title || 'This guide'} has no flashcards yet. Add notes to it, then make cards from them.`
              : 'No cards are due today. Cards come back here when they’re due for review.'}
          </p>
        )}
        <PracticeList practice={queue.practice} />
        {guide
          ? <button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/guide/' + guide.id)}>Open the guide</button>
          : <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/dashboard')}>Dashboard</button>}
        <style jsx>{`
          .session-empty { width: min(760px, 100%); margin: 0 auto; justify-items: start; }
          .session-empty-why { margin: 0; max-width: 60ch; font-size: 16px; }
        `}</style>
      </div>
    );
  }

  return (
    <Reveal phase={gate}>
    <FlashcardViewer
      flashcards={cards}
      title={router.query.guideId ? queue.guides[0]?.title || 'Study now' : 'Daily review'}
      onBack={() => router.push(router.query.guideId ? '/guide/' + router.query.guideId : '/dashboard')}
      onFinish={onFinish}
      finishExtra={<PracticeList practice={queue.practice} />}
    />
    </Reveal>
  );
}
