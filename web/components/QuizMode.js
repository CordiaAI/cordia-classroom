import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { advance, createSession, currentCard, firstAttempts, progress, recordResults } from '../lib/retainEngine.mjs';
import { FillCard, MatchingCard, McCard, WrittenCard } from './RetainCards';

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
      <div className="quiz-result">
        <div className="quiz-score">{score?.score ?? Math.round((finalStats.firstTryRight / Math.max(1, finalStats.total)) * 100)}%</div>
        <div className="quiz-score-label">Retain Score</div>
        <div className="quiz-breakdown">{finalStats.firstTryRight} of {finalStats.total} right on the first try</div>
        {finalStats.missedMastered > 0 && (
          <div className="retain-mastered-note">You mastered {finalStats.missedMastered} question{finalStats.missedMastered === 1 ? '' : 's'} you missed at first.</div>
        )}
        {finalStats.firstTryRight === finalStats.total && <div className="retain-mastered-note">Perfect — every question right on the first try!</div>}
        {saving && <p className="retain-hint">Saving your score…</p>}
        {score?.error && <p className="retain-action-error" role="alert">{score.error}</p>}
        <div className="completion-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onRestart}>Study again</button>
          <button className="btn-outline" onClick={() => window.history.back()}>Back to Guide</button>
        </div>
      </div>
    );
  }

  const props = { card, guideId, onResult, onNext };
  return (
    <div className="quiz-question-card">
      <div className="retain-status-bar">
        <span className="retain-mastered">{stats.cleared} / {stats.total} cleared</span>
        {stats.toClear > 0 && <span className="retain-review-badge">{stats.toClear} to practice again</span>}
      </div>
      <div className="progress-bar-container" style={{ marginBottom: 16 }}>
        <div className="progress-bar-fill" style={{ width: Math.round((stats.cleared / Math.max(1, stats.total)) * 100) + '%' }} />
      </div>
      {card.reask && !answered && (
        <div className="retain-review-label">You missed this one — get it right {session.concepts[card.concepts[0]].needs} more time{session.concepts[card.concepts[0]].needs === 1 ? '' : 's'} to clear it.</div>
      )}
      {card.type === 'matching' && <MatchingCard key={card.id} {...props} questions={questions} />}
      {card.type === 'fill' && <FillCard key={card.id} {...props} question={questions[card.concepts[0]]} />}
      {card.type === 'written' && <WrittenCard key={card.id} {...props} question={questions[card.concepts[0]]} onSwitch={switchType} />}
      {card.type === 'mc' && <McCard key={card.id} {...props} question={questions[card.concepts[0]]} />}
    </div>
  );
}
