import { useEffect, useRef, useState } from 'react';
import { Clock, Play } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { DEFAULT_MINUTES, MINUTE_CHOICES, buildTest, clock, timeLimitSeconds } from '../lib/timedTest.mjs';
import { markAll, scoreRows } from '../lib/submitQuiz.mjs';
import CordiaLoader from './CordiaLoader';
import FeedbackChoice, { useFeedbackChoice } from './FeedbackChoice';
import { PrintQuizButton } from './PrintQuizSheet';
import QuizReview from './QuizReview';
import { ClozeCard, FillCard, McCard, WrittenCard } from './RetainCards';
import { ScoreRing } from './SessionFinish';
import SubmitQuiz from './SubmitQuiz';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const FORMAT = { mc: 'Choose', fill: 'Type it', written: 'Type it', cloze: 'Fill the blank' };
const minutesLabel = minutes => (minutes === 0.5 ? '30 sec' : `${minutes} min`);
const toItems = test => test.map(item => ({ id: item.id, type: item.type, concepts: [item.concept] }));

// What Learn needs once the test is marked (onDone): the misses drop back to Learning and every
// marked answer is logged.
function learnResult(rows, used) {
  const result = scoreRows(rows);
  return {
    score: result.score,
    right: result.right,
    checked: result.marked,
    total: result.total,
    used,
    missed: result.missed.map(row => ({ id: row.itemId, concept: row.concept })),
    unchecked: result.unchecked,
    logged: rows.filter(row => row.response && typeof row.credit === 'number').map(row => ({
      concept: row.concept, type: row.type, credit: row.credit, timing: row.timing || null,
      answerChars: row.type === 'mc' ? null : row.response.length, ...(row.confidence ? { confidence: row.confidence } : {}),
    })),
  };
}

// "After each question" with the clock running: the quiz cards, one try each (no repeats in a test).
function EachRun({ items, questions, guideId, deadline, onFinish }) {
  const [position, setPosition] = useState(0);
  const [overrides, setOverrides] = useState({});
  const [now, setNow] = useState(Date.now());
  const rows = useRef([]);
  const done = useRef(false);
  const left = Math.max(0, Math.round((deadline - now) / 1000));

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  function finish() {
    if (done.current) return;
    done.current = true;
    const answered = new Set(rows.current.map(row => row.itemId));
    const rest = items.filter(item => !answered.has(item.id)).map(item => ({ itemId: item.id, concept: item.concepts[0], type: item.type, response: '', credit: 0, token: null, selfMarked: false, confidence: '' }));
    onFinish([...rows.current, ...rest].sort((a, b) => a.itemId - b.itemId));
  }
  useEffect(() => { if (left === 0) finish(); }, [left]);

  const item = items[position];
  const type = overrides[item.id] || item.type;
  const question = questions[item.concepts[0]];
  const card = { id: `${item.id}-${type}`, type, concepts: item.concepts, reask: false };
  function onResult(results) {
    results.forEach(result => rows.current.push({
      itemId: item.id, concept: result.concept, type, response: result.response || '', credit: result.credit, token: result.token || null,
      selfMarked: Boolean(result.selfMarked), confidence: result.confidence || '', timing: result.timing || null,
    }));
  }
  function onNext() {
    if (position + 1 < items.length) setPosition(position + 1);
    else finish();
  }
  const props = { card, question, guideId, onResult, onNext };
  return (
    <div className="c-card quiz-question-card learn-card tt">
      <div className="learn-card-head">
        <span className="c-meta">Question {position + 1} of {items.length}</span>
        <span className={'tt-clock' + (left <= 60 ? ' is-low' : '')} role="timer" aria-label={`${clock(left)} left`}><Clock {...ICON} />{clock(left)}</span>
        <span className="c-meta learn-type">{FORMAT[type]}</span>
      </div>
      <div className="c-bar" role="progressbar" aria-label="Test" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={position}><span style={{ width: Math.round((position / items.length) * 100) + '%' }} /></div>
      {type === 'mc' && <McCard key={card.id} {...props} />}
      {type === 'fill' && <FillCard key={card.id} {...props} />}
      {type === 'cloze' && <ClozeCard key={card.id} {...props} />}
      {type === 'written' && <WrittenCard key={card.id} {...props} onSwitch={next => setOverrides(current => ({ ...current, [item.id]: next }))} />}
      <div className="quiz-next-row"><button type="button" className="c-btn c-btn--quiet" onClick={finish}>Hand in now</button></div>
    </div>
  );
}

// Learn's timed test: every idea, one clock. "Show if I'm right" picks when answers are marked:
// when the test is submitted (default, like the real thing) or after each question. onDone(result)
// runs once it's marked, so Learn can drop the missed ideas back to Learning.
export default function TimedTest({ guideId, questions, types, onDone, onExit, onRound }) {
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [feedback, setFeedback] = useFeedbackChoice('timed');
  const [screen, setScreen] = useState('setup'); // setup | running | marking | results
  const [items, setItems] = useState(() => toItems(buildTest(questions, types)));
  const [running, setRunning] = useState({ feedback: 'submit', deadline: 0 });
  const [result, setResult] = useState(null);
  const [selfMarks, setSelfMarks] = useState({});
  const started = useRef(0);
  const finishing = useRef(false);

  const limit = timeLimitSeconds(items.length, minutes);

  function start() {
    const test = toItems(buildTest(questions, types));
    finishing.current = false;
    setItems(test);
    setSelfMarks({});
    started.current = Date.now();
    setRunning({ feedback, deadline: started.current + timeLimitSeconds(test.length, minutes) * 1000 });
    setScreen('running');
  }

  function complete(rows) {
    const used = Math.min(limit, Math.round((Date.now() - started.current) / 1000));
    setResult({ rows, used });
    setScreen('results');
    onDone(learnResult(rows, used));
  }

  // When I submit: written answers are marked by AI now, all at once.
  async function handIn({ answers, confidence }) {
    if (finishing.current) return;
    finishing.current = true;
    setScreen('marking');
    const written = items.filter(item => item.type === 'written' && String(answers[item.id] || '').trim());
    const grades = Object.fromEntries(await Promise.all(written.map(async item => {
      const data = await apiFetch(`/quiz/${guideId}/grade`, { method: 'POST', body: JSON.stringify({ concept: item.concepts[0], answer: String(answers[item.id]).trim() }) });
      return [item.id, typeof data?.credit === 'number' ? { credit: data.credit, token: data.token } : null];
    })));
    complete(markAll(items, questions, answers, confidence, grades));
  }

  if (screen === 'setup') {
    return (
      <section className="c-card learn-panel tt">
        <h2 className="c-section-title">Timed test</h2>
        <p className="c-meta">All {items.length} ideas, in the ways you learn with. {feedback === 'submit' ? 'No answers until you submit, like the real thing.' : 'You see each answer as you go; the clock keeps running.'}</p>
        <div className="tt-pace" role="group" aria-label="Time per question">
          {MINUTE_CHOICES.map(choice => (
            <button key={choice} type="button" className={'learn-way tt-pace-btn' + (minutes === choice ? ' is-on' : '')} aria-pressed={minutes === choice} onClick={() => setMinutes(choice)}>
              <span>{minutesLabel(choice)}</span><small>per question</small>
            </button>
          ))}
        </div>
        <FeedbackChoice value={feedback} onChange={setFeedback} id="tt-feedback" />
        <p className="tt-total"><Clock {...ICON} />{clock(limit)} for the whole test</p>
        <div className="learn-actions">
          <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={start} disabled={!items.length}><Play {...ICON} />Start test</button>
          <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={onExit}>Back</button>
        </div>
        <TestStyle />
      </section>
    );
  }

  if (screen === 'running') {
    return running.feedback === 'submit'
      ? <><SubmitQuiz questions={questions} items={items} deadline={running.deadline} onSubmit={handIn} /><TestStyle /></>
      : <><EachRun items={items} questions={questions} guideId={guideId} deadline={running.deadline} onFinish={complete} /><TestStyle /></>;
  }

  if (screen === 'marking' || !result) {
    return <div className="tt-wait"><CordiaLoader size={28} label="Marking your test" /><span className="c-meta">Marking your test…</span><TestStyle /></div>;
  }

  const rows = result.rows.map(row => (row.credit === null && row.itemId in selfMarks ? { ...row, credit: selfMarks[row.itemId], selfMarked: true } : row));
  const score = scoreRows(rows);
  return (
    <div className="learn-home tt">
      <section className="c-card learn-panel tt-results">
        <h2 className="c-section-title">Test done</h2>
        <ScoreRing value={score.score} />
        <p className="c-meta">{score.right} of {score.marked} right</p>
        <p className="tt-total"><Clock {...ICON} />{clock(result.used)} of {clock(limit)} used</p>
        {score.unchecked.length > 0 && <p className="c-meta">{score.unchecked.length === 1 ? '1 written answer' : `${score.unchecked.length} written answers`} couldn&rsquo;t be checked by AI right now. Check {score.unchecked.length === 1 ? 'it' : 'them'} yourself below; until then {score.unchecked.length === 1 ? 'it isn’t' : 'they aren’t'} in the score.</p>}
        {score.missed.length > 0
          ? <p className="c-meta">The ones you missed are back in Learning, so your next rounds start with them.</p>
          : <p className="c-meta">Nothing missed.</p>}
      </section>
      <section className="c-card learn-panel">
        <h2 className="c-section-title">Your answers</h2>
        <QuizReview rows={rows} questions={questions} guideId={guideId} onSelfCheck={(id, credit) => setSelfMarks(current => ({ ...current, [id]: credit }))} />
      </section>
      <div className="learn-actions">
        {score.missed.length > 0 && <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={onRound}>Learn the misses</button>}
        <button type="button" className={'c-btn c-btn--lg ' + (score.missed.length ? 'c-btn--secondary' : 'c-btn--primary')} onClick={onExit}>Back to Learn</button>
        <PrintQuizButton guideId={guideId} />
      </div>
      <TestStyle />
    </div>
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
      .tt-results { justify-items: center; text-align: center; }
      .tt-results p { margin: 0; }
    `}</style>
  );
}
