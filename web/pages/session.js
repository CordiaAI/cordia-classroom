import { useCallback, useEffect, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PencilRuler } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { loadStudyQueue } from '../lib/studyQueue';
import { rememberRetainMisses, retainMisses } from '../lib/userStore';
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

// Daily review: due flashcards, then Retain misses, then open practice problems.
// With ?guideId= it is that guide's Study now.
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

  const cards = queue ? [...queue.cards, ...queue.misses] : [];
  // Nothing to flip: Start goes straight into the first open practice set, not a menu.
  const directPractice = queue && !cards.length && queue.practice.length ? queue.practice[0].guideId : '';
  useEffect(() => {
    if (directPractice) router.replace('/practice/' + directPractice);
  }, [directPractice, router]);

  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const byGuide = new Map();
    const knownSet = new Set(known);
    cards.forEach((card, index) => {
      if (card.kind !== 'card') return;
      const entry = byGuide.get(card.guideId) || { known: [], unknown: [] };
      if (knownSet.has(index)) entry.known.push(card.index);
      else if (missed.includes(index)) entry.unknown.push(card.index);
      byGuide.set(card.guideId, entry);
    });
    const requests = [...byGuide.entries()].map(([guideId, entry]) => {
      const guide = queue.guides.find(item => item.id === guideId);
      // Known cards come back later, missed ones tomorrow (lib/spacedReview.mjs).
      const next = applyResults(guide?.flashcard_progress, { known: entry.known, missed: entry.unknown });
      return apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify(next) });
    });
    // Retain misses answered right here are cleared.
    const stored = retainMisses();
    const clearedByGuide = {};
    cards.forEach((card, index) => {
      if (card.kind === 'miss' && knownSet.has(index)) (clearedByGuide[card.guideId] ||= new Set()).add(card.position);
    });
    Object.entries(clearedByGuide).forEach(([guideId, positions]) => {
      rememberRetainMisses(guideId, (stored[guideId] || []).filter((_, position) => !positions.has(position)));
    });
    requests.push(apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify({ session_type: 'flashcard', duration_seconds: seconds, metadata: { cards_studied: cards.length, cards_correct: known.length, mixed: true } }),
    }));
    await Promise.all(requests);
  }, [cards, queue]);

  if (!ready) return null;
  if (!queue || directPractice || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading your session" />;


  if (!cards.length) {
    return (
      <div className="c-page session-empty">
        <h1 className="c-title">{queue.practice.length ? 'Practice' : 'All done'}</h1>
        <PracticeList practice={queue.practice} />
        <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/dashboard')}>Dashboard</button>
        <style jsx>{`.session-empty { width: min(760px, 100%); margin: 0 auto; justify-items: start; }`}</style>
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
