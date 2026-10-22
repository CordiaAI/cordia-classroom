import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { advance, createSession, currentCard, firstAttempts, progress, recordResults } from '../lib/retainEngine.mjs';
import { Repeat } from 'lucide-react';
import SessionFinish from './SessionFinish';
import { FillCard, MatchingCard, McCard, WrittenCard } from './RetainCards';
import { rememberRetainMisses } from '../lib/userStore';
import { conceptAnswer } from '../lib/retainEngine.mjs';
import { walkthroughEvent } from '../lib/walkthrough';

// Retain: every idea is asked once in its best-fitting format. A miss must then be answered
// right two more times, a few questions apart, before it clears. The score is first-try only.
export default function QuizMode({ questions, cards, types, guideId, onRestart, onDone, doneLabel }) {
  const [session, setSession] = useState(() => createSession(questions, cards, types));
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const card = currentCard(session);
  const stats = progress(session);

  function onResult(results) {
    setSession(current => recordResults(current, currentCard(current), results));
    setAnswered(true);
  }

  async function onNext() {
    const next = advance(session);
    setSession(next);
    setAnswered(false);
    if (!currentCard(next)) {
      // First-try misses come back in the guide's Study now; ones the student was sure of come first.
      const misses = firstAttempts(next).filter(item => item.credit < 1)
        .map(item => ({ question: questions[item.concept]?.question || '', answer: conceptAnswer(questions[item.concept]), ...(item.confidence === 'sure' ? { sure: true } : {}) }))
        .filter(item => item.question && item.answer)
        .sort((a, b) => Number(Boolean(b.sure)) - Number(Boolean(a.sure)));
      rememberRetainMisses(guideId, misses);
      walkthroughEvent('quiz-done');
      setSaving(true);
      const data = await apiFetch(`/quiz/${guideId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ attempts: firstAttempts(next) }),
      });
      setSaving(false);
      setScore(typeof data?.score === 'number' ? data : { error: data?.detail || 'Your score could not be saved.' });
    }
  }

  // A written answer that can't be checked right now is asked as multiple choice instead.
  function switchType(type) {
    setSession(current => ({
      ...current,
      queue: current.queue.map((item, index) => (index === current.position ? { ...item, type, id: current.nextId } : item)),
      nextId: current.nextId + 1,
    }));
  }

  if (!card) {
    const finalStats = progress(session);
    const accuracy = score?.score ?? Math.round((finalStats.firstTryRight / Math.max(1, finalStats.total)) * 100);
    const sureMisses = firstAttempts(session).filter(item => item.credit < 1 && item.confidence === 'sure').length;
    return (
      <SessionFinish guideId={guideId} cards={finalStats.total} accuracy={accuracy} minutes={(Date.now() - startedAt) / 60000} kind="quiz" onRestart={onRestart} onDone={onDone} doneSpot="quiz-done" doneLabel={doneLabel}>
        {saving && <span className="c-meta" role="status">Saving…</span>}
        {score?.error && <p className="retain-action-error" role="alert">{score.error}</p>}
        {sureMisses > 0 && <p className="c-meta finish-sure">{sureMisses === 1 ? 'One answer you were sure of was wrong.' : `${sureMisses} answers you were sure of were wrong.`} Those come back first in Study now, so they stick.</p>}
      </SessionFinish>
    );
  }

  const props = { card, guideId, onResult, onNext };
  return (
    <div className="c-card quiz-question-card">
      <div className="quiz-progress">
        <div className="c-bar" role="progressbar" aria-label="Cleared" aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={stats.cleared}><span style={{ width: Math.round((stats.cleared / Math.max(1, stats.total)) * 100) + '%' }} /></div>
        <span className="c-meta">{stats.cleared} / {stats.total}</span>
        {stats.toClear > 0 && <span className="c-meta quiz-repeat"><Repeat size={16} strokeWidth={1.75} aria-hidden="true" />{stats.toClear}</span>}
      </div>
      {card.reask && !answered && (
        <div className="quiz-reask"><Repeat size={20} strokeWidth={1.75} aria-hidden="true" />Repeat · {session.concepts[card.concepts[0]].needs} left</div>
      )}
      {card.type === 'matching' && <MatchingCard key={card.id} {...props} questions={questions} />}
      {card.type === 'fill' && <FillCard key={card.id} {...props} question={questions[card.concepts[0]]} />}
      {card.type === 'written' && <WrittenCard key={card.id} {...props} question={questions[card.concepts[0]]} onSwitch={switchType} />}
      {card.type === 'mc' && <McCard key={card.id} {...props} question={questions[card.concepts[0]]} />}
    </div>
  );
}
