import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Brain, CalendarClock, Check, GraduationCap, Layers, ListChecks, PenLine, Play, Repeat, Shuffle, Target, TextCursorInput, Timer } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import useSessionTracker from '../../lib/useSessionTracker';
import { recordStudy } from '../../lib/activity';
import { rememberRetainMisses } from '../../lib/userStore';
import { conceptAnswer } from '../../lib/retainEngine.mjs';
import {
  FAMILIAR, LEARNING, LEVELS, MASTERED,
  DEFAULT_TYPES, LEARN_TYPES, advance, answer, cleanTypes, counts, createRound, currentCard, dayKey, formatDecision, linkedTestDate, readiness, restoreLevels, saveableLevels, testPlan,
} from '../../lib/learnEngine.mjs';
import { logAnswer, logFormatDecision, useAnswerTiming } from '../../lib/learningEvents';
import { applyTest } from '../../lib/timedTest.mjs';
import { needsStudySet } from '../../lib/studySet.mjs';
import { makeStudySet } from '../../lib/autoStudySet';
import TimedTest from '../../components/TimedTest';
import { ClozeCard, FillCard, McCard, WrittenCard } from '../../components/RetainCards';
import CordiaLoader, { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import Toggle from '../../components/Toggle';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const TYPE_NAMES = { mc: 'Choose', fill: 'Type it', written: 'Type it', cloze: 'Fill the blank', self: 'Flashcard' };
const LEVEL_CLASS = ['is-new', 'is-learning', 'is-familiar', 'is-mastered'];
const localKey = id => 'cordiaLearn:' + id;
const SURE_KEY = 'cordiaLearnAskSure';
const TYPES_KEY = 'cordiaLearnTypes';
// The ways to learn, like Quiz's question types.
const WAYS = {
  mc: { label: 'Choice', icon: ListChecks, note: 'Pick from four' },
  type: { label: 'Type it', icon: PenLine, note: 'Answer from memory' },
  cloze: { label: 'Fill the blank', icon: TextCursorInput, note: 'Type the missing word' },
  self: { label: 'Flashcards', icon: Layers, note: 'Flip and be honest' },
};

function readLocal(id) {
  try { return JSON.parse(localStorage.getItem(localKey(id)) || 'null'); } catch { return null; }
}

function whenLabel(plan) {
  if (!plan) return '';
  if (plan.past) return 'Your test date has passed. Set the next one.';
  if (plan.daysLeft === 0) return plan.remaining ? `Test today. ${plan.remaining} still to master: do a quick round, then a final check.` : 'Test today. Everything is mastered: run a final check.';
  const days = plan.daysLeft === 1 ? '1 day' : `${plan.daysLeft} days`;
  if (!plan.remaining) return `${days} to go and everything is mastered. Keep it fresh with a final check.`;
  return `${days} to go. Master about ${plan.perDay} a day to be ready the day before.`;
}

// Flashcards: the question on the front; flip it (tap or Space) to see the answer, then say
// honestly whether you knew it (1 / 2). Also used when a written answer can't be checked by AI.
function FlipCard({ card, question, onResult, onNext }) {
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(null);
  const timing = useAnswerTiming();
  const answerText = conceptAnswer(question);

  function flip() {
    if (done !== null) return;
    timing.done(); // the answer is recalled before the first flip; that's when it's timed
    setFlipped(value => !value);
  }
  function mark(credit) {
    if (!flipped || done !== null) return;
    setDone(credit);
    onResult([{ concept: card.concepts[0], credit, response: '', timing: timing.done() }]);
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea, [contenteditable="true"]') || event.metaKey || event.ctrlKey) return;
      if (event.key === ' ' && done === null) { event.preventDefault(); flip(); }
      else if (event.key === '1') mark(0);
      else if (event.key === '2') mark(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <button type="button" className={'learn-flip' + (flipped ? ' is-flipped' : '')} onClick={flip} disabled={done !== null}
        aria-label={flipped ? `Answer: ${answerText}` : `${question.question}. Flip to see the answer`}>
        <span className="learn-flip-inner">
          <span className="learn-flip-face learn-flip-front" aria-hidden={flipped}>
            <small>Question</small>
            <span className="learn-flip-text">{question.question}</span>
            <span className="c-meta">Think of the answer, then flip · <kbd>Space</kbd></span>
          </span>
          <span className="learn-flip-face learn-flip-back" aria-hidden={!flipped}>
            <small>Answer</small>
            <span className="learn-flip-text">{answerText}</span>
          </span>
        </span>
      </button>
      {flipped && done === null && (
        <div className="quiz-next-row learn-flip-marks">
          <span className="c-meta">Did you know it?</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={() => mark(0)}>I missed it <kbd>1</kbd></button>
          <button type="button" className="c-btn c-btn--primary" onClick={() => mark(1)}>I got it <kbd>2</kbd></button>
        </div>
      )}
      {done !== null && <div className="quiz-next-row"><button type="button" className="c-btn c-btn--primary quiz-next" onClick={onNext} autoFocus>Next</button></div>}
    </>
  );
}

function LadderBar({ tally }) {
  const parts = [['mastered', 'Mastered'], ['familiar', 'Familiar'], ['learning', 'Learning'], ['new', 'New']];
  return (
    <div className="learn-ladder">
      <div className="learn-bar" role="img" aria-label={parts.map(([key, label]) => `${tally[key]} ${label}`).join(', ')}>
        {parts.map(([key]) => tally[key] > 0 && <span key={key} className={'learn-seg is-' + key} style={{ flexGrow: tally[key] }} />)}
      </div>
      <ul className="learn-legend">
        {parts.map(([key, label]) => (
          <li key={key}><i className={'learn-dot is-' + key} aria-hidden="true" /><strong>{tally[key]}</strong> {label}</li>
        ))}
      </ul>
    </div>
  );
}

export default function LearnPage() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  useSessionTracker('quiz', guideId);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState(null);
  const [levels, setLevels] = useState({});
  const [testDate, setTestDate] = useState('');
  const [error, setError] = useState('');
  // A guide with notes but no questions yet (a Canvas import, a review set) gets them made here.
  const [making, setMaking] = useState(false);
  const [screen, setScreen] = useState('home');
  const [round, setRound] = useState(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [askSure, setAskSure] = useState(true);
  const [types, setTypes] = useState(DEFAULT_TYPES);
  const roundStart = useRef(Date.now());
  const sessionStart = useRef(Date.now());
  // Each card's logged format decision, by card id; its answer points at it.
  const decisions = useRef({});
  const today = dayKey();

  useEffect(() => {
    try {
      setAskSure(localStorage.getItem(SURE_KEY) !== 'off');
      setTypes(cleanTypes(JSON.parse(localStorage.getItem(TYPES_KEY) || 'null')));
    } catch { /* defaults */ }
  }, []);

  // At least one way stays on.
  function toggleType(type) {
    const next = types.includes(type) ? types.filter(item => item !== type) : LEARN_TYPES.filter(item => item === type || types.includes(item));
    if (!next.length) return;
    setTypes(next);
    try { localStorage.setItem(TYPES_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
  }

  function changeAskSure(on) {
    setAskSure(on);
    try { localStorage.setItem(SURE_KEY, on ? 'on' : 'off'); } catch { /* this visit only */ }
  }

  async function load() {
    const safe = promise => promise.catch(() => null);
    const startSession = () => safe(apiFetch(`/quiz/${guideId}/session`, { method: 'POST', body: JSON.stringify({ types: ['mc', 'written'] }) }));
    setError('');
    let [guideData, session] = await Promise.all([safe(apiFetch(`/guides/${guideId}`)), startSession()]);
    let guide = guideData?.guide;
    setTitle(guide?.title || '');
    if (needsStudySet(guide)) {
      setMaking(true);
      const made = await makeStudySet(guide);
      if (made.error) { setError(made.error); setQuestions([]); setMaking(false); return; }
      guide = made.guide;
      session = await startSession();
    }
    const list = Array.isArray(session?.questions) ? session.questions : [];
    // The account's saved progress wins; this browser's copy covers a backend that hasn't got it yet.
    const saved = guide?.flashcard_progress?.learn || readLocal(guideId) || {};
    const restored = restoreLevels(list, saved.levels || {});
    // An exam's "Study now" passes its date (?test=YYYY-MM-DD) so Learn paces to it.
    const linked = list.length ? linkedTestDate(router.query.test, saved.test_date || '', today) : '';
    setLevels(restored);
    setTestDate(linked || saved.test_date || '');
    if (linked) save(restored, linked, list);
    if (!list.length) setError(session?.detail || (guide && !String(guide.notes || '').trim()
      ? 'This guide has no notes or questions to learn from yet.'
      : 'Learn needs questions and answers. Open the guide and make its study set first.'));
    setQuestions(list);
    setMaking(false);
  }

  useEffect(() => {
    if (ready && guideId) load();
  }, [ready, guideId]);
  const gate = useLoadGate(questions !== null || making);

  function save(nextLevels, nextDate = testDate, list = questions) {
    const body = { levels: saveableLevels(list, nextLevels), test_date: nextDate || null };
    try { localStorage.setItem(localKey(guideId), JSON.stringify(body)); } catch { /* the account copy is enough */ }
    apiFetch(`/guides/${guideId}/learn-progress`, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => {});
  }

  function changeDate(value) {
    setTestDate(value);
    save(levels, value);
  }

  // Logs why this card is asked in its format, before it shows (phase 1: fixed rules, no exploration).
  function decide(card, reason = null) {
    if (!card || (decisions.current[card.id] && !reason)) return;
    const question = questions[card.concept];
    const entry = levels[card.concept];
    const decision = formatDecision(question, entry, today, types, card.type);
    const daysToExam = testDate ? Math.round((new Date(testDate + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000) : null;
    decisions.current[card.id] = logFormatDecision({
      guideId,
      question: question.question,
      decision,
      context: {
        level: entry.l, again: Boolean(card.again), days_to_exam: daysToExam,
        minutes_in_session: Math.round((Date.now() - sessionStart.current) / 60000), ...(reason ? { reason } : {}),
      },
    });
  }

  function startRound() {
    const next = createRound(questions, levels, today, types);
    if (!next.queue.length) return;
    decide(currentCard(next));
    setRound(next);
    setRoundNumber(number => number + 1);
    setAnswered(false);
    roundStart.current = Date.now();
    setScreen('round');
  }

  function onResult(results) {
    const [result] = results;
    const card = currentCard(round);
    results.forEach(item => logAnswer({
      guideId, question: questions[item.concept]?.question, mode: 'learn', type: card.type, credit: item.credit,
      confidence: item.confidence, timing: item.timing, answerChars: item.answerChars, decisionId: decisions.current[card.id],
    }));
    const next = answer(levels, round, card, result.credit, { confidence: result.confidence || '', today });
    setLevels(next.levels);
    setRound(next.round);
    setAnswered(true);
  }

  function onNext() {
    const next = advance(round);
    setAnswered(false);
    if (currentCard(next)) { decide(currentCard(next)); setRound(next); return; }
    setRound(next);
    finishRound(next);
  }

  function finishRound(done) {
    save(levels);
    const results = Object.entries(done.results);
    const missed = results.filter(([, item]) => item.missed).map(([concept]) => questions[concept]);
    const cleared = results.filter(([, item]) => !item.missed).map(([concept]) => questions[concept]?.question).filter(Boolean);
    rememberRetainMisses(guideId, missed.map(question => ({ question: question.question, answer: conceptAnswer(question) })).filter(item => item.question && item.answer), { cleared });
    recordStudy({ guideId, guideTitle: title, minutes: (Date.now() - roundStart.current) / 60000, cards: results.length, right: results.length - missed.length, total: results.length, kind: 'quiz' });
    setScreen('checkpoint');
  }

  // A timed test is marked: what it missed drops back to Learning for the next rounds.
  function testDone(result) {
    const next = applyTest(levels, result.missed, today);
    setLevels(next);
    save(next);
    const missed = result.missed.map(item => questions[item.concept]);
    result.logged?.forEach(item => logAnswer({ guideId, question: questions[item.concept]?.question, mode: 'timed_test', ...item }));
    rememberRetainMisses(guideId, missed.map(question => ({ question: question.question, answer: conceptAnswer(question) })).filter(item => item.question && item.answer));
    recordStudy({ guideId, guideTitle: title, minutes: result.used / 60, cards: result.total, right: result.right, total: result.checked, kind: 'quiz' });
  }

  // A written answer that can't be checked right now becomes a self-check.
  function switchToSelf() {
    decide({ ...currentCard(round), type: 'self' }, 'grading_unavailable');
    setRound(current => ({ ...current, queue: current.queue.map((item, index) => (index === current.position ? { ...item, type: 'self' } : item)) }));
  }

  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Getting Learn ready" />;
  if (making || questions === null) return (
    <div className="c-page learn-page">
      <div className="learn-making" role="status">
        <CordiaLoader size={48} label="Making questions from your notes" />
        <p className="c-section-title">Making questions from your notes…</p>
        <p className="c-meta">This takes about a minute. Learn opens when they're ready.</p>
      </div>
      <style jsx>{`
        .learn-making { display: grid; justify-items: center; gap: 12px; min-height: calc(100vh - var(--bar-h) - 160px); align-content: center; text-align: center; }
        .learn-making p { margin: 0; }
      `}</style>
    </div>
  );

  const tally = counts(questions, levels, today);
  const ready_ = readiness(tally);
  const plan = testPlan(tally, testDate, today);
  const allMastered = tally.total > 0 && tally.mastered === tally.total;
  const card = screen === 'round' ? currentCard(round) : null;
  const inside = screen === 'round' || screen === 'timed';
  const retainCard = card && { id: card.id, type: card.type, concepts: [card.concept], reask: card.again };
  const question = card && questions[card.concept];
  const roundSize = round ? new Set(round.queue.map(item => item.concept)).size : 0;
  const roundDone = round ? Object.keys(round.results).length : 0;

  return (
    <Reveal phase={gate}>
    <div className="c-page learn-page">
      <header className="c-page-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => (inside ? setScreen('home') : router.push('/guide/' + guideId))} aria-label={screen === 'round' ? 'Stop this round' : screen === 'timed' ? 'Leave the test' : 'Back to guide'}><ArrowLeft {...ICON} /></button>
          <h1 className="c-title">Learn</h1>
        </div>
      </header>
      {title && <p className="c-section-title learn-guide">{title}</p>}
      {error && (
        <div className="retain-action-error" role="alert">
          {error} <Link href={'/guide/' + guideId}>Open the guide</Link>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm learn-retry" onClick={load}>Try again</button>
        </div>
      )}

      {screen === 'home' && tally.total > 0 && (
        <div className="learn-home">
          <section className="c-card learn-panel">
            <div className="learn-ready">
              <span className="learn-ready-num">{ready_}%</span>
              <span className="c-meta">ready</span>
            </div>
            <LadderBar tally={tally} />
            {tally.fading > 0 && <p className="c-meta learn-fade"><Repeat size={16} strokeWidth={1.75} aria-hidden="true" />{tally.fading === 1 ? '1 mastered idea is' : `${tally.fading} mastered ideas are`} fading. It comes back for a quick check.</p>}
          </section>

          <section className="c-card learn-panel learn-test">
            <label className="learn-date">
              <span><CalendarClock {...ICON} />Test date</span>
              <input type="date" className="c-input" value={testDate} min={today} onChange={event => changeDate(event.target.value)} />
            </label>
            <p className="c-meta">{plan ? whenLabel(plan) : 'Add the date and Learn paces you so everything is mastered the day before.'}</p>
          </section>

          <section className="learn-ways" aria-labelledby="learn-ways-title">
            <h2 id="learn-ways-title" className="c-section-title">How do you want to learn?</h2>
            <div className="learn-way-grid" role="group" aria-label="Ways to learn">
              {LEARN_TYPES.map(type => {
                const way = WAYS[type];
                const on = types.includes(type);
                return (
                  <button key={type} type="button" className={'learn-way' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => toggleType(type)}>
                    <way.icon size={26} strokeWidth={1.75} aria-hidden="true" />
                    <span>{way.label}</span>
                    <small>{way.note}</small>
                  </button>
                );
              })}
            </div>
            <p className="c-meta">{!types.some(type => type !== 'mc')
              ? 'Only Choice: an idea is mastered by choosing it right once it\'s familiar. Add Type it or Written to master by recalling, which sticks better for a test.'
              : 'New ideas start with your first pick; familiar ones are asked from memory to master them.'}</p>
          </section>

          <section className="c-card learn-panel learn-sure">
            <Toggle checked={askSure} onChange={changeAskSure} label="Ask how sure I am" />
            <p className="c-meta">After each choice: Sure, Think so or Guess. It helps a lot: ideas you already know skip ahead, lucky guesses don't count as learned, and confident misses come back first.</p>
          </section>

          <div className="learn-actions">
            {!allMastered || tally.fading > 0 ? (
              <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={startRound}>
                <Play {...ICON} />{tally.new === tally.total ? 'Start learning' : 'Next round'}
              </button>
            ) : null}
            {allMastered && (
              <Link href={'/quiz/' + guideId} className="c-btn c-btn--primary c-btn--lg"><Target {...ICON} />Final check</Link>
            )}
          </div>

          <section className="learn-ways" aria-labelledby="learn-test-title">
            <h2 id="learn-test-title" className="c-section-title">Test yourself</h2>
            <div className="learn-way-grid learn-test-grid">
              <Link href={'/quiz/' + guideId} className="learn-way"><Brain size={26} strokeWidth={1.75} aria-hidden="true" /><span>Quiz</span><small>Every idea, misses repeat</small></Link>
              <button type="button" className="learn-way" onClick={() => setScreen('timed')}><Timer size={26} strokeWidth={1.75} aria-hidden="true" /><span>Timed test</span><small>A mock exam on the clock</small></button>
              <Link href={'/quiz/' + guideId + '?mode=match'} className="learn-way"><Shuffle size={26} strokeWidth={1.75} aria-hidden="true" /><span>Match</span><small>Pair them up in 60 seconds</small></Link>
            </div>
          </section>

          <ul className="learn-how">
            <li><GraduationCap {...ICON} /><span><strong>Rounds of {Math.min(7, tally.total)}.</strong> Recognise the answer first, then recall it from memory. Recall is what masters an idea.</span></li>
            <li><Check {...ICON} /><span><strong>Guesses don't count.</strong> {askSure ? 'A lucky guess stays in Learning, and a confident miss comes back first.' : 'Turn on "Ask how sure I am" so lucky guesses aren\'t counted as learned.'}</span></li>
            <li><Repeat {...ICON} /><span><strong>Misses come back</strong> later in the same round, and mastered ideas return after {5} days so they stay fresh for the test.</span></li>
          </ul>
        </div>
      )}

      {screen === 'round' && card && (
        <div className="c-card quiz-question-card learn-card">
          <div className="learn-card-head">
            <span className="c-meta">Round {roundNumber} · {Math.min(roundDone + (answered ? 0 : 1), roundSize)} of {roundSize}</span>
            <span className={'learn-chip ' + LEVEL_CLASS[levels[card.concept].l]}>{LEVELS[levels[card.concept].l]}</span>
            <span className="c-meta learn-type">{card.again ? 'Again' : TYPE_NAMES[card.type]}</span>
          </div>
          <div className="c-bar" role="progressbar" aria-label="Round" aria-valuemin={0} aria-valuemax={round.queue.length} aria-valuenow={round.position}><span style={{ width: Math.round((round.position / round.queue.length) * 100) + '%' }} /></div>
          {card.type === 'mc' && <McCard key={card.id} askSure={askSure} card={retainCard} question={question} guideId={guideId} onResult={onResult} onNext={onNext} />}
          {card.type === 'fill' && <FillCard key={card.id} askSure={askSure} card={retainCard} question={question} guideId={guideId} onResult={onResult} onNext={onNext} />}
          {card.type === 'written' && <WrittenCard key={card.id} card={retainCard} question={question} guideId={guideId} onResult={onResult} onNext={onNext} onSwitch={switchToSelf} />}
          {card.type === 'cloze' && <ClozeCard key={card.id} askSure={askSure} card={retainCard} question={question} guideId={guideId} onResult={onResult} onNext={onNext} />}
          {card.type === 'self' && <FlipCard key={card.id + '-self'} card={retainCard} question={question} onResult={onResult} onNext={onNext} />}
        </div>
      )}

      {screen === 'timed' && (
        <TimedTest guideId={guideId} questions={questions} types={types} onDone={testDone} onExit={() => setScreen('home')} onRound={startRound} />
      )}

      {screen === 'checkpoint' && round && (
        <div className="learn-home">
          <section className="c-card learn-panel">
            <h2 className="c-section-title">Round {roundNumber} done</h2>
            <div className="learn-ready"><span className="learn-ready-num">{ready_}%</span><span className="c-meta">ready</span></div>
            <LadderBar tally={tally} />
            <ul className="learn-moves">
              {Object.entries(round.results).map(([concept, item]) => (
                <li key={concept}>
                  <span className="c-truncate">{questions[concept].question}</span>
                  <span className={'learn-chip ' + LEVEL_CLASS[item.to]}>{item.to > item.from ? '↑ ' : item.to < item.from ? '↓ ' : ''}{LEVELS[item.to]}</span>
                </li>
              ))}
            </ul>
            {plan && !plan.past && <p className="c-meta">{whenLabel(plan)}</p>}
          </section>
          <div className="learn-actions">
            {allMastered && !tally.fading
              ? <Link href={'/quiz/' + guideId} className="c-btn c-btn--primary c-btn--lg"><Target {...ICON} />Final check</Link>
              : <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={startRound}>Next round<ArrowRight {...ICON} /></button>}
            <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={() => setScreen('home')}>Overview</button>
          </div>
        </div>
      )}

      {/* Global so LadderBar, a separate component, gets them too; every class here starts with learn-. */}
      <style jsx global>{`
        .learn-page { width: min(760px, 100%); margin: 0 auto; }
        .learn-guide { margin: -12px 0 0; font-family: var(--font-sans); }
        .learn-home { display: grid; gap: 16px; }
        .learn-panel { display: grid; gap: 14px; padding: 22px; }
        .learn-panel h2 { margin: 0; }
        .learn-ready { display: flex; align-items: baseline; gap: 8px; }
        .learn-ready-num { font: 600 44px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--ink); }
        .learn-ladder { display: grid; gap: 10px; }
        .learn-bar { display: flex; gap: 2px; height: 12px; overflow: hidden; border-radius: var(--r-pill); background: var(--hairline); }
        .learn-seg { min-width: 6px; border-radius: var(--r-pill); }
        .learn-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; padding: 0; list-style: none; color: var(--muted); font: 500 14px/1.3 var(--font-sans); }
        .learn-legend li { display: inline-flex; align-items: center; gap: 6px; }
        .learn-legend strong { color: var(--ink); font-variant-numeric: tabular-nums; }
        .learn-dot { width: 10px; height: 10px; border-radius: var(--r-pill); }
        .is-mastered.learn-seg, .is-mastered.learn-dot { background: var(--success); }
        .is-familiar.learn-seg, .is-familiar.learn-dot { background: color-mix(in srgb, var(--olive) 45%, transparent); }
        .is-learning.learn-seg, .is-learning.learn-dot { background: var(--warning); }
        .is-new.learn-seg, .is-new.learn-dot { background: var(--border-default); }
        .learn-fade { display: flex; align-items: center; gap: 6px; margin: 0; }
        .learn-test .c-meta, .learn-sure .c-meta { margin: 0; }
        .learn-sure { gap: 8px; }
        .learn-ways { display: grid; gap: 10px; }
        .learn-ways h2, .learn-ways .c-meta { margin: 0; }
        .learn-way-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .learn-flip { display: block; width: 100%; margin: 4px 0 14px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: center; cursor: pointer; perspective: 1400px; }
        .learn-flip:disabled { cursor: default; }
        .learn-flip:focus-visible { outline: none; }
        .learn-flip:focus-visible .learn-flip-face { box-shadow: 0 0 0 3px var(--olive-tint); }
        .learn-flip-inner { position: relative; display: grid; min-height: 240px; transform-style: preserve-3d; transition: transform 520ms var(--ease); }
        .learn-flip.is-flipped .learn-flip-inner { transform: rotateY(180deg); }
        .learn-flip-face { grid-area: 1 / 1; display: grid; align-content: center; justify-items: center; gap: 14px; padding: 28px 24px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        .learn-flip-back { transform: rotateY(180deg); background: linear-gradient(var(--olive-tint), var(--olive-tint)), var(--card); }
        .learn-flip-face small { color: var(--muted); font: 600 12px/1 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; }
        .learn-flip-text { max-width: 36ch; color: var(--ink); font: 500 22px/1.4 var(--font-sans); }
        .learn-flip:not(:disabled):hover .learn-flip-face { border-color: var(--olive); }
        .learn-flip-marks { align-items: center; }
        .learn-flip-marks .c-meta { margin-right: auto; }
        @media (prefers-reduced-motion: reduce) { .learn-flip-inner { transition: none; } }
        .learn-way { display: grid; justify-items: center; align-content: center; gap: 6px; min-height: 112px; padding: 12px 8px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); font: 600 15px/1.2 var(--font-sans); text-align: center; cursor: pointer; }
        .learn-way .lucide { color: var(--olive-ink); }
        .learn-way small { color: var(--muted); font: 500 12px/1.3 var(--font-sans); }
        .learn-way.is-on { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .learn-way:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .learn-date { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font: 600 16px/1.3 var(--font-sans); }
        .learn-date span { display: inline-flex; align-items: center; gap: 8px; }
        .learn-date input { width: auto; min-width: 170px; }
        .learn-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .learn-test-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        a.learn-way { text-decoration: none; }
        .learn-retry { margin-left: 8px; }
        .learn-how { display: grid; gap: 12px; margin: 4px 0 0; padding: 0; list-style: none; }
        .learn-how li { display: flex; gap: 12px; color: var(--muted); font: 500 15px/1.45 var(--font-sans); }
        .learn-how li .lucide { flex: none; margin-top: 2px; color: var(--olive-ink); }
        .learn-how strong { color: var(--ink); }
        .learn-card { width: min(720px, 100%); justify-self: center; }
        .learn-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .learn-type { margin-left: auto; }
        .learn-chip { padding: 3px 10px; border-radius: var(--r-pill); font: 600 12px/1.3 var(--font-sans); white-space: nowrap; }
        .learn-chip.is-new { background: var(--surface-raised); color: var(--muted); }
        .learn-chip.is-learning { background: var(--warning-bg); color: var(--warning); }
        .learn-chip.is-familiar { background: var(--olive-tint); color: var(--olive-ink); }
        .learn-chip.is-mastered { background: var(--success-bg); color: var(--success); }
        .learn-moves { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .learn-moves li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 8px 0; border-top: 1px solid var(--border-subtle); font: 500 15px/1.35 var(--font-sans); }
        @media (max-width: 520px) {
          .learn-actions .c-btn { flex: 1; justify-content: center; }
          .learn-ready-num { font-size: 36px; }
          .learn-way-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .learn-test-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
      `}</style>
    </div>
    </Reveal>
  );
}
