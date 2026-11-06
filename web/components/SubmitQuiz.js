import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, Flag } from 'lucide-react';
import { choiceText, conceptAnswer, shuffled } from '../lib/retainEngine.mjs';
import { makeCloze } from '../lib/learnEngine.mjs';
import { clock } from '../lib/timedTest.mjs';
import { isAnswered, unanswered } from '../lib/submitQuiz.mjs';
import { CONFIDENCE } from './RetainCards';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const FORMAT = { mc: 'Choose', fill: 'Type it', cloze: 'Fill the blank', written: 'Written', matching: 'Match' };

// "Show if I'm right: When I submit". Every question can be answered, changed, flagged and
// revisited; nothing says right or wrong until the whole quiz is handed in (onSubmit). With a
// deadline, time running out hands it in as it is. resume / onProgress keep it across a refresh.
export default function SubmitQuiz({ questions, items, deadline = null, resume = null, onProgress, onSubmit }) {
  const [answers, setAnswers] = useState(() => resume?.answers || {});
  const [confidence, setConfidence] = useState(() => resume?.confidence || {});
  const [flags, setFlags] = useState(() => resume?.flags || []);
  const [position, setPosition] = useState(() => Math.min(resume?.position || 0, Math.max(0, items.length - 1)));
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(Date.now());
  const handedIn = useRef(false);
  // Choice order and the matching answer bank stay put while the student moves around.
  const orders = useMemo(() => Object.fromEntries(items.map(item => [item.id, item.type === 'matching'
    ? shuffled(item.concepts.map(concept => choiceText(conceptAnswer(questions[concept]))), item.id * 31 + 7)
    : shuffled((questions[item.concepts[0]].options || []).map(choiceText), item.id * 7919 + 13)])), [items, questions]);

  useEffect(() => { onProgress?.({ answers, confidence, flags, position }); }, [answers, confidence, flags, position]);

  useEffect(() => {
    if (!deadline) return undefined;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [deadline]);
  const left = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null;

  function handIn() {
    if (handedIn.current) return;
    handedIn.current = true;
    onSubmit({ answers, confidence });
  }
  // Time's up: hand in what's there, no warning.
  useEffect(() => { if (deadline && left === 0) handIn(); }, [left]);

  const item = items[position];
  const question = questions[item.concepts[0]];
  const response = answers[item.id];
  const answered = isAnswered(item, response);
  const flagged = flags.includes(item.id);
  const missing = unanswered(items, answers);

  function answer(value) {
    setConfirming(false);
    setAnswers(current => ({ ...current, [item.id]: value }));
  }
  function place(concept, value) {
    answer({ ...(response || {}), [concept]: value });
  }
  function go(index) {
    setPosition(Math.max(0, Math.min(items.length - 1, index)));
    setConfirming(false);
  }
  function submit() {
    if (missing.length) setConfirming(true);
    else handIn();
  }

  return (
    <div className="sq">
      <div className="c-card quiz-question-card sq-card">
        <div className="sq-head">
          <span className="c-meta">Question {position + 1} of {items.length}</span>
          {left !== null && <span className={'tt-clock' + (left <= 60 ? ' is-low' : '')} role="timer" aria-label={`${clock(left)} left`}><Clock {...ICON} />{clock(left)}</span>}
          <span className="c-meta sq-format">{FORMAT[item.type]}</span>
          <button type="button" className={'c-btn c-btn--quiet c-btn--sm sq-flag' + (flagged ? ' is-on' : '')} aria-pressed={flagged}
            onClick={() => setFlags(current => (flagged ? current.filter(id => id !== item.id) : [...current, item.id]))}>
            <Flag size={16} strokeWidth={1.75} aria-hidden="true" fill={flagged ? 'currentColor' : 'none'} />Flag for review
          </button>
        </div>

        {item.type === 'matching' ? (
          <>
            <div className="quiz-question-text">Match each one to its answer</div>
            <ol className="sq-match">
              {item.concepts.map(concept => (
                <li key={concept}>
                  <span>{questions[concept].question}</span>
                  <select className="c-input" value={response?.[concept] || ''} onChange={event => place(concept, event.target.value)} aria-label={`Answer for: ${questions[concept].question}`}>
                    <option value="">Choose an answer</option>
                    {orders[item.id].map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="quiz-question-text">{question.question}</div>
        )}

        {item.type === 'mc' && orders[item.id].map(option => (
          <button key={option} type="button" className={'quiz-option' + (response === option ? ' selected' : '')} aria-pressed={response === option} onClick={() => answer(option)}>
            <span className="quiz-option-text">{option}</span>
          </button>
        ))}
        {item.type === 'cloze' && (() => {
          const cloze = makeCloze(conceptAnswer(question));
          return cloze ? <p className="retain-cloze">{cloze.before}<span className="retain-cloze-blank" aria-label="missing word">______</span>{cloze.after}</p> : null;
        })()}
        {(item.type === 'fill' || item.type === 'cloze') && (
          <input key={item.id} className="retain-fill-input" value={response || ''} onChange={event => answer(event.target.value)}
            placeholder={item.type === 'cloze' ? 'The missing word' : 'Type the answer'} aria-label={item.type === 'cloze' ? 'The missing word' : 'Your answer'} autoComplete="off" />
        )}
        {item.type === 'written' && (
          <textarea key={item.id} className="retain-written-input" value={response || ''} onChange={event => answer(event.target.value)} placeholder="Your answer" aria-label="Your answer" rows={4} maxLength={4000} />
        )}

        {answered && (
          <div className="retain-sure sq-sure" role="group" aria-label="How sure are you?">
            <span className="c-meta">How sure are you?</span>
            {CONFIDENCE.map(level => (
              <button key={level.key} type="button" className={'c-btn c-btn--secondary c-btn--sm' + (confidence[item.id] === level.key ? ' is-on' : '')} aria-pressed={confidence[item.id] === level.key}
                onClick={() => setConfidence(current => ({ ...current, [item.id]: level.key }))}>{level.label}</button>
            ))}
          </div>
        )}
        <p className={'sq-saved' + (answered ? ' is-saved' : '')} role="status">{answered ? <><Check size={16} strokeWidth={2} aria-hidden="true" />Answer saved</> : 'Not answered yet'}</p>

        <div className="quiz-next-row sq-nav">
          <button type="button" className="c-btn c-btn--secondary" onClick={() => go(position - 1)} disabled={position === 0}><ArrowLeft {...ICON} />Previous</button>
          {position + 1 < items.length
            ? <button type="button" className="c-btn c-btn--primary" onClick={() => go(position + 1)}>Next<ArrowRight {...ICON} /></button>
            : <button type="button" className="c-btn c-btn--primary" onClick={submit}>Submit quiz</button>}
        </div>
      </div>

      <section className="c-card sq-panel" aria-label="Questions">
        <div className="sq-panel-head">
          <span className="c-meta">{items.length - missing.length} of {items.length} answered{flags.length ? ` · ${flags.length} flagged` : ''}</span>
          <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={submit}>Submit quiz</button>
        </div>
        <ol className="sq-grid">
          {items.map((entry, index) => {
            const done = isAnswered(entry, answers[entry.id]);
            const marked = flags.includes(entry.id);
            return (
              <li key={entry.id}>
                <button type="button" className={'sq-cell' + (done ? ' is-answered' : '') + (marked ? ' is-flagged' : '') + (index === position ? ' is-current' : '')}
                  aria-current={index === position ? 'step' : undefined} aria-label={`Question ${index + 1}, ${done ? 'answered' : 'not answered'}${marked ? ', flagged' : ''}`} onClick={() => go(index)}>
                  {index + 1}{marked && <Flag size={10} strokeWidth={2.25} aria-hidden="true" fill="currentColor" />}
                </button>
              </li>
            );
          })}
        </ol>
        <ul className="sq-legend" aria-hidden="true">
          <li><i className="sq-dot is-answered" />Answered</li>
          <li><i className="sq-dot" />Unanswered</li>
          <li><i className="sq-dot is-flagged" />Flagged</li>
        </ul>
        {confirming && (
          <div className="sq-confirm" role="alertdialog" aria-labelledby="sq-confirm-text">
            <p id="sq-confirm-text">{missing.length === 1 ? '1 question isn’t answered' : `${missing.length} questions aren’t answered`}: {missing.map(entry => items.indexOf(entry) + 1).join(', ')}. Unanswered questions count as missed.</p>
            <div className="quiz-next-row">
              <button type="button" className="c-btn c-btn--secondary" onClick={() => { setConfirming(false); go(items.indexOf(missing[0])); }} autoFocus>Keep working</button>
              <button type="button" className="c-btn c-btn--primary" onClick={handIn}>Submit anyway</button>
            </div>
          </div>
        )}
      </section>

      <style jsx global>{`
        .sq { display: grid; gap: 16px; width: min(720px, 100%); justify-self: center; }
        .sq-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .sq-format { margin-left: auto; }
        .sq-flag.is-on { color: var(--warning); }
        .sq-match { display: grid; gap: 10px; margin: 0 0 8px; padding: 0; list-style: none; }
        .sq-match li { display: grid; gap: 6px; }
        .sq-match span { font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
        .sq-sure .is-on { background: var(--olive-tint); border-color: var(--olive); color: var(--olive-ink); }
        .sq-saved { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--muted); font: 500 var(--fs-13)/1.4 var(--font-sans); }
        .sq-saved.is-saved { color: var(--success); }
        .sq-nav { justify-content: space-between; }
        .sq-panel { display: grid; gap: 12px; padding: 16px; }
        .sq-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .sq-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
        .sq-cell { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 2px; width: 100%; height: 40px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--ink); font: 600 14px/1 var(--font-sans); font-variant-numeric: tabular-nums; cursor: pointer; }
        .sq-cell.is-answered { background: var(--olive-tint); border-color: transparent; color: var(--olive-ink); }
        .sq-cell.is-flagged { box-shadow: inset 0 0 0 2px var(--warning); }
        .sq-cell.is-flagged .lucide { color: var(--warning); }
        .sq-cell.is-current { outline: 2px solid var(--olive); outline-offset: 2px; }
        .sq-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 0; list-style: none; color: var(--muted); font: 500 var(--fs-13)/1.3 var(--font-sans); }
        .sq-legend li { display: inline-flex; align-items: center; gap: 6px; }
        .sq-dot { width: 12px; height: 12px; border-radius: 4px; border: 1px solid var(--line); background: var(--card); }
        .sq-dot.is-answered { background: var(--olive-tint); border-color: transparent; }
        .sq-dot.is-flagged { box-shadow: inset 0 0 0 2px var(--warning); }
        .sq-confirm { display: grid; gap: 10px; padding: 12px 14px; border-radius: var(--r-row, 14px); background: var(--warning-bg); }
        .sq-confirm p { margin: 0; color: var(--ink); font: 500 15px/1.45 var(--font-sans); }
      `}</style>
    </div>
  );
}
