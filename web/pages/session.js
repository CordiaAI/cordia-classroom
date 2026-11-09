import { useCallback, useEffect, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PencilRuler } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { learnAfterReview, loadStudyQueue } from '../lib/studyQueue';
import { clearRetainMisses } from '../lib/userStore';
import { saveStudyResults } from '../lib/progressSave';
import { loadFolders } from '../lib/folders';
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

const text = value => (typeof value === 'string' ? value : '');
// Ids from the address bar become links back (Back, Open the guide): only well-formed ones count.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = value => (typeof value === 'string' && UUID.test(value) ? value : '');

// Daily review: Retain misses, due flashcards and Learn ideas in one round (lib/studyQueue.js),
// then open practice problems. With ?guideId= it is that guide's Study now; with
// ?scope=folder|classroom&id= (and, for a classroom, &guides= the picked guide ids) it is the same
// round across that folder's or classroom's guides, dealt in turn.
export default function StudySession() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [queue, setQueue] = useState(null);
  const gate = useLoadGate(Boolean(queue));
  const guideId = uuid(router.query.guideId);
  const scope = ['folder', 'classroom'].includes(router.query.scope) && uuid(router.query.id) ? router.query.scope : '';
  const scopeId = scope ? uuid(router.query.id) : '';

  useEffect(() => {
    if (!ready || !router.isReady) return;
    const guideIds = text(router.query.guides).split(',').map(uuid).filter(Boolean);
    const folderName = scope === 'folder'
      ? loadFolders().then(data => (data?.folders || []).find(folder => folder.id === scopeId)?.name || '').catch(() => '')
      : Promise.resolve('');
    Promise.all([loadStudyQueue({ guideId, scope, id: scopeId, guideIds }), folderName])
      .then(([loaded, name]) => setQueue({ ...loaded, folderName: name }));
  }, [ready, router.isReady]);

  const cards = queue ? queue.items : [];
  // Nothing to flip: Start goes straight into the first open practice set, not a menu.
  const directPractice = queue && !cards.length && queue.practice.length ? queue.practice[0].guideId : '';
  useEffect(() => {
    if (directPractice) router.replace('/practice/' + directPractice);
  }, [directPractice, router]);

  // Each answer is saved to every record its question came from (lib/studyQueue.js). A card missed
  // at least once this round counts as missed, even after a later Got it.
  const onFinish = useCallback(async ({ known, missed, seconds }) => {
    const knownSet = new Set(known);
    const missedSet = new Set(missed);
    const byGuide = new Map();
    cards.forEach((card, position) => {
      const right = knownSet.has(position) && !missedSet.has(position);
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
      // Known cards come back later, missed ones tomorrow (lib/spacedReview.mjs); Learn ideas move
      // up or back. Saved together, card by card, so answers saved meanwhile elsewhere are kept.
      // Someone else's guide (a classroom's) saves to your own progress on it, never theirs.
      await saveStudyResults(guideId, guide?.flashcard_progress, { known: entry.known, missed: entry.unknown }, learnAfterReview(guide, entry.learn), guide?.viewer || null);
    });
    requests.push(apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify({ session_type: 'flashcard', duration_seconds: seconds, metadata: { cards_studied: cards.length, cards_correct: known.length, mixed: true } }),
    }));
    await Promise.all(requests);
  }, [cards, queue]);

  const backTo = scope === 'classroom' && UUID.test(scopeId) ? `/classrooms/${scopeId}?tab=study`
    : scope === 'folder' && UUID.test(scopeId) ? '/folder/' + scopeId
      : UUID.test(guideId) ? '/guide/' + guideId : '/dashboard';
  const roundTitle = scope === 'classroom' ? queue?.classroom?.name || 'Classroom review'
    : scope === 'folder' ? queue?.folderName || 'Folder review'
      : guideId ? queue?.guides[0]?.title || 'Study now' : 'Daily review';

  if (!ready) return null;
  if (!queue || directPractice || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading your session" />;


  // Nothing to flip: say why, and offer the one next step (a bare "All done" explained nothing).
  if (!cards.length) {
    const guide = guideId ? queue.guides[0] : null;
    const title = queue.practice.length ? 'Practice' : guide ? 'Nothing to study yet' : 'All caught up';
    const where = scope === 'classroom' ? 'in this classroom' : scope === 'folder' ? 'in this folder' : 'today';
    return (
      <div className="c-page session-empty">
        <h1 className="c-title">{title}</h1>
        {!queue.practice.length && (
          <p className="c-meta session-empty-why">
            {guide
              ? `${guide.title || 'This guide'} has no flashcards yet. Add notes to it, then make cards from them.`
              : `No cards are due ${where}. Cards come back here when they’re due for review.`}
          </p>
        )}
        <PracticeList practice={queue.practice} />
        {guide
          ? <button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/guide/' + guide.id)}>Open the guide</button>
          : <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push(backTo)}>{scope === 'classroom' ? 'Back to the classroom' : scope === 'folder' ? 'Back to the folder' : 'Dashboard'}</button>}
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
      title={roundTitle}
      onBack={() => router.push(backTo)}
      onFinish={onFinish}
      finishExtra={<PracticeList practice={queue.practice} />}
      logMode="study_now"
    />
    </Reveal>
  );
}
