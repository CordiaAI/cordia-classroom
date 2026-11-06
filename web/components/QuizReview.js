import { useState } from 'react';
import { Check, MessageCircle, Minus, Sparkles, X } from 'lucide-react';
import { expected } from '../lib/submitQuiz.mjs';
import { MissFeedback, missDetail } from './RetainCards';

const SURE = { sure: 'Sure', think: 'Think so', guess: 'Guess' };

function verdict(row) {
  if (row.credit === null) return ['unchecked', 'Not checked yet'];
  if (!row.response) return ['wrong', 'Not answered'];
  if (row.credit === 1) return ['right', row.selfMarked ? 'Right (your check)' : 'Right'];
  if (row.credit === 0.5) return ['partial', 'Partly right'];
  return ['wrong', row.selfMarked ? 'Missed (your check)' : 'Not quite'];
}

function Row({ row, number, question, guideId, onSelfCheck }) {
  const [explained, setExplained] = useState(false);
  const [tone, label] = verdict(row);
  const answer = expected(row.type, question);
  const missed = typeof row.credit === 'number' && row.credit < 1;
  const Icon = tone === 'right' ? Check : tone === 'partial' ? Minus : X;
  return (
    <li className={'rv-item is-' + tone}>
      <div className="rv-top">
        <span className="rv-num">{number}</span>
        <span className="rv-q">{question.question}</span>
        <span className={'rv-mark is-' + tone}>{tone !== 'unchecked' && <Icon size={16} strokeWidth={2.25} aria-hidden="true" />}{label}</span>
      </div>
      <dl className="rv-answers">
        <div><dt>Your answer</dt><dd>{row.response || 'Not answered'}{row.confidence && <span className="rv-sure">{SURE[row.confidence]}</span>}</dd></div>
        <div><dt>Correct answer</dt><dd>{answer}</dd></div>
      </dl>
      {tone === 'unchecked' && (
        <div className="rv-self">
          <p className="c-meta">Cordia couldn&rsquo;t check this one right now. Compare yours with the answer:</p>
          <div className="quiz-next-row">
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => onSelfCheck(row.itemId, 0)}>I missed it</button>
            <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => onSelfCheck(row.itemId, 1)}>I got it</button>
          </div>
        </div>
      )}
      {missed && (
        <div className="rv-help">
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', {
            detail: { ...missDetail(guideId, question, row.response || '(no answer)', question.options || []), send: true },
          }))}><MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" />Ask why</button>
          {!explained && <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setExplained(true)}><Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />Explain</button>}
        </div>
      )}
      {explained && <MissFeedback guideId={guideId} card={{ id: `review-${row.itemId}-${row.concept}`, concepts: [row.concept] }} question={question} chosen={row.response || '(no answer)'} sure={row.confidence === 'sure'} />}
    </li>
  );
}

// The results of a quiz handed in all at once: every question with the student's answer and how
// sure they were, the correct answer, and Ask why / Explain on the misses. A written answer the AI
// couldn't check gets "I got it" / "I missed it" instead (onSelfCheck).
export default function QuizReview({ rows, questions, guideId, onSelfCheck }) {
  return (
    <ol className="rv">
      {rows.map((row, index) => <Row key={`${row.itemId}-${row.concept}`} row={row} number={index + 1} question={questions[row.concept]} guideId={guideId} onSelfCheck={onSelfCheck} />)}
      <style jsx global>{`
        .rv { display: grid; gap: 0; width: 100%; margin: 0; padding: 0; list-style: none; text-align: left; }
        .rv-item { display: grid; gap: 8px; padding: 14px 0; border-top: 1px solid var(--border-subtle); }
        .rv-item:first-child { border-top: 0; }
        .rv-top { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: baseline; }
        .rv-num { color: var(--olive-ink); font: 600 14px/1.4 var(--font-sans); font-variant-numeric: tabular-nums; }
        .rv-q { color: var(--ink); font: 600 15px/1.4 var(--font-sans); }
        .rv-mark { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: var(--r-pill); font: 600 12px/1.3 var(--font-sans); white-space: nowrap; }
        .rv-mark.is-right { background: var(--success-bg); color: var(--success); }
        .rv-mark.is-partial, .rv-mark.is-unchecked { background: var(--warning-bg); color: var(--warning); }
        .rv-mark.is-wrong { background: var(--error-bg); color: var(--error); }
        .rv-answers { display: grid; gap: 4px; margin: 0 0 0 38px; }
        .rv-answers div { display: grid; grid-template-columns: 120px 1fr; gap: 8px; }
        .rv-answers dt { color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .rv-answers dd { margin: 0; color: var(--ink); font: 500 15px/1.45 var(--font-sans); }
        .rv-sure { margin-left: 8px; padding: 1px 8px; border-radius: var(--r-pill); background: var(--olive-tint); color: var(--olive-ink); font: 600 12px/1.4 var(--font-sans); }
        .rv-self, .rv-help, .rv-item .retain-why { margin-left: 38px; }
        .rv-self { display: grid; gap: 6px; }
        .rv-self p { margin: 0; }
        .rv-help { display: flex; flex-wrap: wrap; gap: 8px; }
        @media (max-width: 520px) { .rv-answers div { grid-template-columns: 1fr; gap: 0; } .rv-answers, .rv-self, .rv-help, .rv-item .retain-why { margin-left: 0; } }
      `}</style>
    </ol>
  );
}
