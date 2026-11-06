import { useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { logAnswer } from '../lib/learningEvents';
import { rememberRetainMisses } from '../lib/userStore';
import { attemptsFor, markAll, retryOutcome, retrySession, scoreRows, studyNowMisses } from '../lib/submitQuiz.mjs';
import CordiaLoader from './CordiaLoader';
import QuizMode from './QuizMode';
import QuizReview from './QuizReview';
import SessionFinish from './SessionFinish';
import SubmitQuiz from './SubmitQuiz';
import { PrintQuizButton } from './PrintQuizSheet';
import { LEARN_LADDER_V2 } from '../lib/featureFlags';

// Quiz with "Show if I'm right: When I submit": answer everything (SubmitQuiz), then every answer
// is marked at once (written ones by AI, in parallel, with signed grades), the attempt is saved
// with its mode, and the results screen shows each question. "Retry my misses" runs the misses
// through the usual Retain rules without changing the score.
export default function SubmitFlow({ questions, cards, selected, guideId, resume = null, onProgress, onRestart, onDone }) {
  const items = useMemo(() => cards.map((card, i) => ({ id: i, type: card.type, concepts: card.concepts })), [cards]);
  const [stage, setStage] = useState('answering'); // answering | marking | results | retry
  const [handed, setHanded] = useState(null);
  const [grades, setGrades] = useState({});
  const [selfMarks, setSelfMarks] = useState({});
  const [saved, setSaved] = useState(null);
  const [retried, setRetried] = useState(null);
  const startedAt = useRef(resume?.startedAt || Date.now());

  async function submit(given) {
    onProgress?.(null);
    setHanded(given);
    setStage('marking');
    const written = items.filter(item => item.type === 'written' && String(given.answers[item.id] || '').trim());
    const marks = Object.fromEntries(await Promise.all(written.map(async item => {
      const data = await apiFetch(`/quiz/${guideId}/grade`, { method: 'POST', body: JSON.stringify({ concept: item.concepts[0], answer: String(given.answers[item.id]).trim() }) });
      return [item.id, typeof data?.credit === 'number' ? { credit: data.credit, token: data.token } : null];
    })));
    setGrades(marks);
    const rows = markAll(items, questions, given.answers, given.confidence, marks);
    rows.filter(row => row.response && typeof row.credit === 'number').forEach(row => logAnswer({
      guideId, question: questions[row.concept]?.question, mode: 'quiz', type: row.type, credit: row.credit, confidence: row.confidence || undefined,
    }));
    rememberRetainMisses(guideId, studyNowMisses(rows, questions), { cleared: rows.filter(row => row.credit === 1).map(row => questions[row.concept]?.question).filter(Boolean) });
    const attempts = attemptsFor(rows);
    if (attempts.length) {
      const data = await apiFetch(`/quiz/${guideId}/submit`, { method: 'POST', body: JSON.stringify({ attempts, feedback: 'submit' }) });
      setSaved(typeof data?.score === 'number' ? data : { error: data?.detail || 'Your score could not be saved.' });
    }
    setStage('results');
  }

  if (stage === 'answering') {
    return <SubmitQuiz questions={questions} items={items} resume={resume} onProgress={snapshot => onProgress?.({ ...snapshot, feedback: 'submit', startedAt: startedAt.current })} onSubmit={submit} />;
  }
  if (stage === 'marking') {
    return <div className="tt-wait"><CordiaLoader size={28} label="Checking your answers" /><span className="c-meta">Checking your answers…</span></div>;
  }

  const rows = markAll(items, questions, handed.answers, handed.confidence, grades, selfMarks);
  const result = scoreRows(rows);

  if (stage === 'retry') {
    return (
      <QuizMode questions={questions} cards={[]} types={selected} guideId={guideId} retry={retrySession(questions, rows, selected, { ladder: LEARN_LADDER_V2 })}
        onRetryDone={session => {
          const outcome = retryOutcome(session);
          setRetried(outcome);
          setStage('results');
          if (saved?.attempt_id) apiFetch(`/quiz/${guideId}/attempts/${saved.attempt_id}/retry`, { method: 'POST', body: JSON.stringify(outcome) });
        }} />
    );
  }

  return (
    <SessionFinish guideId={guideId} cards={result.total} accuracy={result.score} minutes={(Date.now() - startedAt.current) / 60000} kind="quiz" onRestart={onRestart} onDone={onDone} doneSpot="quiz-done">
      {saved?.error && <p className="retain-action-error" role="alert">{saved.error}</p>}
      {result.unchecked.length > 0 && (
        <p className="c-meta">{result.unchecked.length === 1 ? '1 written answer' : `${result.unchecked.length} written answers`} couldn&rsquo;t be checked by AI right now. Check {result.unchecked.length === 1 ? 'it' : 'them'} yourself below; until then {result.unchecked.length === 1 ? 'it’s' : 'they’re'} left out of your score.</p>
      )}
      {retried && <p className="c-meta" role="status">Retry done: {retried.cleared} of {retried.of} {retried.of === 1 ? 'miss' : 'misses'} cleared. Your score counts first tries only.</p>}
      <div className="c-row sf-actions">
        {result.missed.length > 0 && !retried && <button type="button" className="c-btn c-btn--primary" onClick={() => setStage('retry')}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Retry my misses</button>}
        <PrintQuizButton guideId={guideId} />
      </div>
      <QuizReview rows={rows} questions={questions} guideId={guideId} onSelfCheck={(id, credit) => setSelfMarks(current => ({ ...current, [id]: credit }))} />
      <style jsx>{`
        .sf-actions { justify-content: center; flex-wrap: wrap; }
      `}</style>
    </SessionFinish>
  );
}
