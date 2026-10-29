import { useEffect, useRef, useState } from 'react';
import { Clock, Play, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { conceptAnswer, shuffled } from '../lib/retainEngine.mjs';
import { answerTimer } from '../lib/learningEvents.mjs';
import { makeCloze } from '../lib/learnEngine.mjs';
import { DEFAULT_MINUTES, MINUTE_CHOICES, buildTest, clock, markLocal, testResults, timeLimitSeconds } from '../lib/timedTest.mjs';
import CordiaLoader from './CordiaLoader';
import { MissFeedback } from './RetainCards';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const FORMAT = { mc: 'Choose', fill: 'Type it', written: 'Type it', cloze: 'Fill the blank' };
const minutesLabel = minutes => (minutes === 0.5 ? '30 sec' : `${minutes} min`);

// A missed idea on the results screen; Explain asks why the right answer is right.
function Missed({ item, question, response, guideId }) {
  const [explained, setExplained] = useState(false);
  return (
    <li className="tt-missed">
      <span className="tt-missed-q">{question.question}</span>
      {response ? <span className="c-meta">You: {response}</span> : <span className="c-meta">Not answered</span>}
      <p className="retain-guide-answer"><span>Answer</span>{conceptAnswer(question)}</p>
      {explained
        ? <MissFeedback guideId={guideId} card={{ id: item.id, concepts: [item.concept] }} question={question} chosen={response || '(no answer)'} />
        : <button type="button" className="c-btn c-btn--secondary c-btn--sm tt-explain" onClick={() => setExplained(true)}><Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />Explain</button>}
    </li>
  );
}

// Learn's timed test: every idea, one clock, marks only at the end. onDone(result) runs once the
// test is marked, so Learn can drop the missed ideas back to Learning.
export default function TimedTest({ guideId, questions, types, onDone, onExit, onRound }) {
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [screen, setScreen] = useState('setup'); // setup | running | marking | results
  const [items, setItems] = useState(() => buildTest(questions, types));
  const [position, setPosition] = useState(0);
  const [value, setValue] = useState('');
  const [responses, setResponses] = useState({});
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState(null);
  const options = useRef({});
  const grading = useRef({});
  const started = useRef(0);
  const deadline = useRef(0);
  const finishing = useRef(false);
  // Each answer's timing, by item id, and the clock for the question on screen.
  const timings = useRef({});
  const timer = useRef(null);
  const startTimer = () => { timer.current = answerTimer(() => performance.now(), document.hidden); };

  const limit = timeLimitSeconds(items.length, minutes);
  const left = Math.max(0, Math.round((deadline.current - now) / 1000));

  function start() {
    const test = buildTest(questions, types);
    options.current = Object.fromEntries(test.filter(item => item.type === 'mc').map(item => [item.id, shuffled(questions[item.concept].options || [], item.id * 7919 + Date.now() % 1000)]));
    grading.current = {};
    timings.current = {};
    startTimer();
    finishing.current = false;
    setItems(test);
    setPosition(0);
    setValue('');
    setResponses({});
    started.current = Date.now();
    deadline.current = started.current + timeLimitSeconds(test.length, minutes) * 1000;
    setNow(Date.now());
    setScreen('running');
  }

  useEffect(() => {
    if (screen !== 'running') return undefined;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    const onVisibility = () => timer.current?.visibility(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(ticker); document.removeEventListener('visibilitychange', onVisibility); };
  }, [screen]);

  // Time's up: whatever is answered is handed in.
  useEffect(() => {
    if (screen === 'running' && now >= deadline.current) finish({ ...responses, ...(value.trim() ? { [items[position].id]: value.trim() } : {}) });
  }, [now]);

  // A written answer is sent for marking as soon as it's given; the student sees nothing yet.
  function keep(item, response) {
    if (item.type === 'written' && response) {
      grading.current[item.id] = apiFetch(`/quiz/${guideId}/grade`, { method: 'POST', body: JSON.stringify({ concept: item.concept, answer: response }) })
        .then(data => (typeof data?.credit === 'number' ? data.credit : null))
        .catch(() => null);
    }
    return { ...responses, ...(response ? { [item.id]: response } : {}) };
  }

  function next(event) {
    event?.preventDefault();
    const item = items[position];
    const kept = keep(item, value.trim());
    timings.current[item.id] = timer.current?.done();
    startTimer();
    setResponses(kept);
    setValue('');
    if (position + 1 < items.length) setPosition(position + 1);
    else finish(kept);
  }

  async function finish(given) {
    if (finishing.current) return;
    finishing.current = true;
    const onScreen = items[position];
    if (onScreen && !timings.current[onScreen.id]) timings.current[onScreen.id] = timer.current?.done();
    const used = Math.min(limit, Math.round((Date.now() - started.current) / 1000));
    setScreen('marking');
    const credits = {};
    await Promise.all(items.map(async item => {
      const response = given[item.id] || '';
      if (!response) return;
      credits[item.id] = item.type === 'written' ? await (grading.current[item.id] || null) : markLocal(item, questions[item.concept], response);
    }));
    // Answers that were given and checked, for the learning log (unanswered ones aren't answers).
    const logged = items.filter(item => given[item.id] && typeof credits[item.id] === 'number').map(item => ({
      concept: item.concept, type: item.type, credit: credits[item.id], timing: timings.current[item.id] || null,
      answerChars: item.type === 'mc' ? null : given[item.id].length,
    }));
    const marked = { ...testResults(items, credits), used, responses: given, logged };
    setResult(marked);
    setScreen('results');
    onDone(marked);
  }

  if (screen === 'setup') {
    return (
      <section className="c-card learn-panel tt">
        <h2 className="c-section-title">Timed test</h2>
        <p className="c-meta">All {items.length} ideas, in the ways you learn with. No answers until the end, like the real thing.</p>
        <div className="tt-pace" role="group" aria-label="Time per question">
          {MINUTE_CHOICES.map(choice => (
            <button key={choice} type="button" className={'learn-way tt-pace-btn' + (minutes === choice ? ' is-on' : '')} aria-pressed={minutes === choice} onClick={() => setMinutes(choice)}>
              <span>{minutesLabel(choice)}</span><small>per question</small>
            </button>
          ))}
        </div>
        <p className="tt-total"><Clock {...ICON} />{clock(limit)} for the whole test</p>
        <div className="learn-actions">
          <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={start} disabled={!items.length}><Play {...ICON} />Start test</button>
          <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={onExit}>Back</button>
        </div>
        <TestStyle />
      </section>
    );
  }

  if (screen === 'marking') {
    return <div className="tt-wait"><CordiaLoader size={28} label="Marking your test" /><span className="c-meta">Marking your test…</span><TestStyle /></div>;
  }

  if (screen === 'results' && result) {
    return (
      <div className="learn-home tt">
        <section className="c-card learn-panel">
          <h2 className="c-section-title">Test done</h2>
          <div className="learn-ready"><span className="learn-ready-num">{result.score}%</span><span className="c-meta">{result.right} of {result.checked} right</span></div>
          <p className="tt-total"><Clock {...ICON} />{clock(result.used)} of {clock(limit)} used</p>
          {result.unchecked.length > 0 && <p className="c-meta">{result.unchecked.length === 1 ? '1 written answer' : `${result.unchecked.length} written answers`} couldn't be checked and {result.unchecked.length === 1 ? "isn't" : "aren't"} in the score.</p>}
          {result.missed.length > 0
            ? <p className="c-meta">The ones you missed are back in Learning, so your next rounds start with them.</p>
            : <p className="c-meta">Nothing missed.</p>}
        </section>
        {result.missed.length > 0 && (
          <section className="c-card learn-panel">
            <h2 className="c-section-title">Missed</h2>
            <ul className="tt-missed-list">
              {result.missed.map(item => <Missed key={item.id} item={item} question={questions[item.concept]} response={result.responses[item.id] || ''} guideId={guideId} />)}
            </ul>
          </section>
        )}
        <div className="learn-actions">
          {result.missed.length > 0 && <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={onRound}>Learn the misses</button>}
          <button type="button" className={'c-btn c-btn--lg ' + (result.missed.length ? 'c-btn--secondary' : 'c-btn--primary')} onClick={onExit}>Back to Learn</button>
        </div>
        <TestStyle />
      </div>
    );
  }

  const item = items[position];
  const question = questions[item.concept];
  return (
    <form className="c-card quiz-question-card learn-card tt" onSubmit={next}>
      <div className="learn-card-head">
        <span className="c-meta">Question {position + 1} of {items.length}</span>
        <span className={'tt-clock' + (left <= 60 ? ' is-low' : '')} role="timer" aria-label={`${clock(left)} left`}><Clock {...ICON} />{clock(left)}</span>
        <span className="c-meta learn-type">{FORMAT[item.type]}</span>
      </div>
      <div className="c-bar" role="progressbar" aria-label="Test" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={position}><span style={{ width: Math.round((position / items.length) * 100) + '%' }} /></div>
      <div className="quiz-question-text">{question.question}</div>
      {item.type === 'mc' && (options.current[item.id] || []).map(option => (
        <button key={option} type="button" className={'quiz-option' + (value === option ? ' selected' : '')} aria-pressed={value === option} onClick={() => setValue(option)}>{option}</button>
      ))}
      {item.type === 'cloze' && (() => {
        const cloze = makeCloze(conceptAnswer(question));
        return (
          <>
            <p className="retain-cloze">{cloze.before}<span className="retain-cloze-blank" aria-label="missing word">______</span>{cloze.after}</p>
            <input key={item.id} className="retain-fill-input" value={value} onChange={event => setValue(event.target.value)} onKeyDown={() => timer.current?.key()} placeholder="The missing word" aria-label="The missing word" autoFocus autoComplete="off" />
          </>
        );
      })()}
      {item.type === 'fill' && (
        <input key={item.id} className="retain-fill-input" value={value} onChange={event => setValue(event.target.value)} onKeyDown={() => timer.current?.key()} placeholder="Type the answer" aria-label="Your answer" autoFocus autoComplete="off" />
      )}
      {item.type === 'written' && (
        <textarea key={item.id} className="retain-written-input" value={value} onChange={event => setValue(event.target.value)} onKeyDown={() => timer.current?.key()} placeholder="Your answer" aria-label="Your answer" rows={4} maxLength={4000} autoFocus />
      )}
      <div className="quiz-next-row">
        <button type="button" className="c-btn c-btn--quiet" onClick={() => finish(keep(item, value.trim()))}>Hand in now</button>
        <button type="submit" className="c-btn c-btn--primary quiz-next">{value.trim() ? (position + 1 < items.length ? 'Next' : 'Hand in') : 'Skip'}</button>
      </div>
      <TestStyle />
    </form>
  );
}

function TestStyle() {
  return (
    <style jsx global>{`
      .tt h2 { margin: 0; }
      .tt-pace { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .tt-pace-btn { min-height: 76px; }
      .tt-total { display: flex; align-items: center; gap: 8px; margin: 0; font: 600 16px/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }
      .tt-total .lucide, .tt-clock .lucide { color: var(--olive-ink); }
      .tt-clock { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--r-pill); background: var(--surface-raised); font: 600 14px/1.3 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--ink); }
      .tt-clock.is-low { background: var(--warning-bg); color: var(--warning); }
      .tt-clock.is-low .lucide { color: var(--warning); }
      .tt-wait { display: grid; justify-items: center; gap: 12px; padding: 48px 0; }
      .tt-missed-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
      .tt-missed { display: grid; gap: 6px; padding: 12px 0; border-top: 1px solid var(--border-subtle); }
      .tt-missed:first-child { border-top: 0; padding-top: 0; }
      .tt-missed-q { font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
      .tt-missed .retain-guide-answer { margin: 0; }
      .tt-explain { justify-self: start; }
    `}</style>
  );
}
