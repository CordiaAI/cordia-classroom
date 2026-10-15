import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { advance, createSession, currentCard, firstAttempts, progress, recordResults } from '../lib/retainEngine.mjs';
import { Repeat, RotateCcw } from 'lucide-react';
import { FillCard, MatchingCard, McCard, WrittenCard } from './RetainCards';
import { rememberRetainMisses } from '../lib/userStore';
import { conceptAnswer } from '../lib/retainEngine.mjs';

// Retain: every idea is asked once in its best-fitting format. A miss must then be answered
// right two more times, a few questions apart, before it clears. The score is first-try only.
export default function QuizMode({ questions, cards, types, guideId, onRestart }) {
  const [session, setSession] = useState(() => createSession(questions, cards, types));
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(null);
  const [saving, setSaving] = useState(false);
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
      // First-try misses come back in Today's Start session.
      const misses = firstAttempts(next).filter(item => item.credit < 1).map(item => ({ question: questions[item.concept]?.question || '', answer: conceptAnswer(questions[item.concept]) })).filter(item => item.question && item.answer);
      rememberRetainMisses(guideId, misses);
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
    return (
      <section className="c-card quiz-result" aria-labelledby="quiz-score">
        <div id="quiz-score" className="quiz-score">{score?.score ?? Math.round((finalStats.firstTryRight / Math.max(1, finalStats.total)) * 100)}%</div>
        <ul className="quiz-result-stats">
          <li><strong>{finalStats.firstTryRight} / {finalStats.total}</strong><span>First try</span></li>
          {finalStats.missedMastered > 0 && <li><strong>{finalStats.missedMastered}</strong><span>Mastered</span></li>}
        </ul>
        {saving && <span className="c-meta" role="status">Saving…</span>}
        {score?.error && <p className="retain-action-error" role="alert">{score.error}</p>}
        <div className="c-row">
          <button type="button" className="c-btn c-btn--secondary" onClick={onRestart}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Restart</button>
          <button type="button" className="c-btn c-btn--primary" onClick={() => window.history.back()}>Done</button>
        </div>
      </section>
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
