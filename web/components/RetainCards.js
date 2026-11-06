import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { BookOpen, Check, Lightbulb, Link2, MessageCircle, X } from 'lucide-react';
import { dismissTip, requestTip } from '../lib/tips';
import { walkthroughEvent } from '../lib/walkthrough';
import { noteView, useAnswerTiming } from '../lib/learningEvents';
import { choiceText, conceptAnswer, fillVerdict, normalize, shuffled } from '../lib/retainEngine.mjs';
import { makeCloze } from '../lib/learnEngine.mjs';

// Learn's format ladder (LEARN_LADDER_V2) wraps a round in <QuietLimits.Provider value>: a plan limit
// reached mid-round falls back quietly (Written becomes a self-check) instead of opening the upgrade
// dialog. Everywhere else the default (false) keeps today's behaviour.
export const QuietLimits = createContext(false);

// A wrong answer of any type opens the Tutor's "why was I wrong" help.
// The context for "why was I wrong", sent when the student taps Ask why.
export function missDetail(guideId, question, selectedAnswer, options) {
  return {
    guideId,
    skill: 'retain',
    prompt: 'Can you explain why my answer does not work and help me understand the difference?',
    retainContext: {
      question: question.question,
      options,
      selected_answer: selectedAnswer,
      correct_answer: conceptAnswer(question),
    },
  };
}

let lastMiss = null;

// A wrong answer of any type shows "Ask why"; tapping it opens the Tutor and sends.
export function askTutorAboutMiss(guideId, question, selectedAnswer, options = []) {
  lastMiss = missDetail(guideId, question, selectedAnswer, options);
  walkthroughEvent('quiz-miss');
  requestTip('ask');
}

// One "Ask why" after a miss. onExplain (multiple choice, fill-in, cloze): the card shows why the
// right answer is right and why the student's isn't, on the spot. Without one (matching, written)
// it opens the Tutor on the miss. The Tutor stays a tap away in the corner either way.
export function AskWhy({ onExplain }) {
  return (
    <button type="button" className="c-btn c-btn--secondary quiz-ask" data-spot="ask-why" data-tip="ask" onClick={() => {
      walkthroughEvent('ask');
      dismissTip('ask'); // found it: the "Ask why" tip never needs to show again
      if (onExplain) { onExplain(); return; }
      if (lastMiss) noteView(lastMiss.guideId, lastMiss.retainContext.question, 'ask_why');
      if (lastMiss) window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { ...lastMiss, send: true } }));
    }}>
      <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />Ask why
    </button>
  );
}

// "Help me remember" after a miss: shows a memory hook under the card (MemoryHook). onRemember is
// null once the hook is showing, so the button goes.
export function RememberButton({ onRemember }) {
  if (!onRemember) return null;
  return (
    <button type="button" className="c-btn c-btn--secondary quiz-remember" onClick={onRemember}>
      <Lightbulb size={20} strokeWidth={1.75} aria-hidden="true" />Help me remember
    </button>
  );
}

// A short memory hook for the missed question, in the style the student picked on the About-you
// screen (POST /quiz/{id}/remember). Each one uses a light AI reading; "Another one" asks for a
// different angle. Logged as the view shown, so the next answer says whether a hook came before it.
// Where a "Linked to" chip opens: the guide or lecture the trick built on (a Tutor chat has no page).
function linkedHref(linked) {
  if (linked.kind === 'lecture') return `/lecture/${linked.id}`;
  if (linked.kind === 'guide') return `/guide/${linked.id}`;
  return '';
}

export function MemoryHook({ guideId, concept, question }) {
  const quietLimit = useContext(QuietLimits);
  const [hook, setHook] = useState(null); // null: working; '': failed
  const [linked, setLinked] = useState(null); // {kind, id, title}: the student's own material it built on
  const [round, setRound] = useState(0);
  const previous = useRef('');
  useEffect(() => {
    let active = true;
    setHook(null);
    apiFetch(`/quiz/${guideId}/remember`, { method: 'POST', quietLimit, body: JSON.stringify({ concept, previous: previous.current || null }) })
      .then(data => {
        if (!active) return;
        if (data?.hook) {
          previous.current = data.hook;
          noteView(guideId, question.question, 'mnemonic');
          setHook(data.hook);
          setLinked(data.linked?.title ? data.linked : null);
        } else {
          // Never the server's raw message ("Not Found"); the limit shows its own upgrade dialog.
          setHook('');
        }
      });
    return () => { active = false; };
  }, [guideId, concept, round]);
  return (
    <div className="retain-hook" role="status">
      <span className="retain-hook-title"><Lightbulb size={18} strokeWidth={1.75} aria-hidden="true" />Help me remember</span>
      {question?.question && <p className="retain-hook-cue">{question.question}</p>}
      {hook === null && <p className="c-meta">Thinking of a way to remember it…</p>}
      {hook && <p>{hook}</p>}
      {hook && linked && (linkedHref(linked)
        ? <a className="retain-hook-link" href={linkedHref(linked)} target="_blank" rel="noopener noreferrer"><Link2 size={14} strokeWidth={2} aria-hidden="true" />Linked to: {linked.title}</a>
        : <span className="retain-hook-link"><Link2 size={14} strokeWidth={2} aria-hidden="true" />Linked to: {linked.title}</span>)}
      {hook === '' && <p className="c-meta">Couldn't come up with one right now.</p>}
      {hook !== null && (
        <button type="button" className="retain-hook-again" onClick={() => setRound(value => value + 1)}>
          {hook ? 'Another one' : 'Try again'}
        </button>
      )}
    </div>
  );
}

// onExplain: the card's own explanation of the miss; null once it is showing (no button then).
// onRemember: shows a memory hook (RememberButton); null once it is showing.
function NextButton({ onNext, missed, onExplain, onRemember }) {
  return (
    <div className="quiz-next-row">
      {missed && onExplain !== null && <AskWhy onExplain={onExplain} />}
      {missed && <RememberButton onRemember={onRemember} />}
      <button type="button" className="c-btn c-btn--primary quiz-next" onClick={onNext} autoFocus>Next</button>
    </div>
  );
}

// "How sure are you?" between answering and seeing the result. Wrong answers given with
// confidence are the ones feedback fixes best, so they're flagged and come back first.
export const CONFIDENCE = [
  { key: 'sure', label: 'Sure' },
  { key: 'think', label: 'Think so' },
  { key: 'guess', label: 'Guess' },
];

export function ConfidencePrompt({ onPick }) {
  useEffect(() => {
    // Keys 1-3 pick, matching the order shown.
    function onKey(event) {
      if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const level = CONFIDENCE[Number(event.key) - 1];
      if (level) { event.preventDefault(); onPick(level.key); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPick]);
  return (
    <div className="retain-sure" role="group" aria-label="How sure are you?">
      <span className="c-meta">How sure are you?</span>
      {CONFIDENCE.map((level, index) => (
        <button key={level.key} type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => onPick(level.key)}>
          {level.label}<kbd>{index + 1}</kbd>
        </button>
      ))}
    </div>
  );
}

// Under a missed question: why the right answer is right, why the choice wasn't, and where the
// guide covers it. The two sentences come from the server (POST /quiz/{id}/why).
export function MissFeedback({ guideId, card, question, chosen, sure }) {
  const quietLimit = useContext(QuietLimits);
  const [why, setWhy] = useState(null);
  useEffect(() => {
    let active = true;
    noteView(guideId, question.question, 'explain');
    apiFetch(`/quiz/${guideId}/why`, { method: 'POST', quietLimit, body: JSON.stringify({ concept: card.concepts[0], chosen: String(chosen).slice(0, 4000) }) })
      .then(data => { if (active) setWhy(data?.why_right ? data : {}); });
    return () => { active = false; };
  }, [guideId, card.id]);
  return (
    <div className="retain-why" role="status">
      {sure && <p className="retain-why-sure">You were sure about this one. It comes back first next time, so it sticks.</p>}
      {why === null && <p className="c-meta">Working out why…</p>}
      {why?.why_right && <p><strong>Why it's right:</strong> {why.why_right}</p>}
      {why?.why_wrong && <p><strong>Why yours isn't:</strong> {why.why_wrong}</p>}
      <a className="retain-why-source" href={`/guide/${guideId}?find=${encodeURIComponent(question.question || '')}`} target="_blank" rel="noreferrer">
        <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />See it in your guide
      </a>
    </div>
  );
}

// askSure: false skips "How sure are you?" (Learn lets the student turn it off).
export function McCard({ card, question, guideId, onResult, onNext, askSure = true }) {
  // Choices are shown with matching endings (choiceText), so the answer's period doesn't give it away.
  const answer = choiceText(conceptAnswer(question));
  // Always shuffled, so the right answer's position never gives it away (saved quizzes kept it first).
  const [options] = useState(() => shuffled((question.options || []).map(choiceText), Math.floor(Math.random() * 233280)));
  // An answer is picked, then "How sure?" (first asks only), then it's revealed.
  const [pending, setPending] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confidence, setConfidence] = useState('');
  const [explained, setExplained] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const timing = useAnswerTiming();

  function reveal(option, level = '') {
    setSelected(option);
    setConfidence(level);
    const right = option === answer;
    if (!right) askTutorAboutMiss(guideId, question, option, options);
    onResult([{ concept: card.concepts[0], credit: right ? 1 : 0, response: option, timing: timing.done(), nOptions: options.length, ...(level ? { confidence: level } : {}) }]);
  }

  function choose(option) {
    if (selected !== null) return;
    timing.done(); // the answer is the pick; "How sure?" comes after it
    // A repeat of a missed question goes straight to the answer.
    if (card.reask || !askSure) { reveal(option); return; }
    setPending(option);
  }

  // Keys 1-4 pick the choice with that number, the order shown.
  useEffect(() => {
    if (selected !== null || pending !== null) return undefined;
    function onKey(event) {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const option = options[Number(event.key) - 1];
      if (option !== undefined && Number(event.key) <= 4) { event.preventDefault(); choose(option); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function optionClass(option) {
    if (selected === null) return 'quiz-option' + (pending === option ? ' selected' : '');
    if (option === answer) return 'quiz-option ' + (selected === answer ? 'correct-shine' : 'correct-glow');
    if (option === selected) return 'quiz-option wrong-shake';
    return 'quiz-option disabled';
  }

  // Right and wrong are never colour alone: an icon and a word on the option, and a spoken status.
  function optionMark(option) {
    if (selected === null) return null;
    if (option === answer) return <span className="quiz-option-mark is-right"><Check size={16} strokeWidth={2.25} aria-hidden="true" />Correct</span>;
    if (option === selected) return <span className="quiz-option-mark is-wrong"><X size={16} strokeWidth={2.25} aria-hidden="true" />Your answer</span>;
    return null;
  }
  const status = selected === null ? '' : selected === answer ? 'Correct' : `Not quite. The answer is: ${answer}`;

  return (
    <>
      <div className="quiz-question-text">{question.question}</div>
      {options.map(option => (
        <button key={option} type="button" className={optionClass(option)} aria-pressed={selected === null ? pending === option : option === selected} onClick={() => choose(option)}>
          <span className="quiz-option-text">{option}</span>{optionMark(option)}
        </button>
      ))}
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {selected === null && pending !== null && <ConfidencePrompt onPick={level => reveal(pending, level)} />}
      {explained && <MissFeedback guideId={guideId} card={card} question={question} chosen={selected} sure={confidence === 'sure'} />}
      {remembering && <MemoryHook guideId={guideId} concept={card.concepts[0]} question={question} />}
      {selected !== null && <NextButton onNext={onNext} missed={selected !== answer} onExplain={explained ? null : () => setExplained(true)} onRemember={remembering ? null : () => setRemembering(true)} />}
    </>
  );
}

// The typed-answer flow shared by FillCard and ClozeCard. A plainly right answer counts at once.
// Otherwise the student sees the answer and decides: a close one ("Alpha Sigma" for "Oregon Alpha
// Sigma") asks "Count it right?"; a wrong one offers "I was right". The choice is recorded (marked
// self_marked when they count it right) and the next question follows.
function useTypedAnswer({ card, question, guideId, onResult, onNext, expected, value, timing }) {
  const [verdict, setVerdict] = useState(null); // right | close | wrong
  const [credit, setCredit] = useState(null);
  const [confidence, setConfidence] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const next = useRef(onNext);
  next.current = onNext;
  // After the render that carries the recorded answer, so the round moves on from the new state.
  useEffect(() => {
    if (!advancing) return undefined;
    const timer = setTimeout(() => next.current(), 0);
    return () => clearTimeout(timer);
  }, [advancing]);

  function record(points, level, selfMarked = false) {
    setCredit(points);
    onResult([{ concept: card.concepts[0], credit: points, response: value.trim(), timing: timing.done(), answerChars: value.trim().length, ...(level ? { confidence: level } : {}), ...(selfMarked ? { selfMarked: true } : {}) }]);
  }
  function reveal(level = '') {
    setConfidence(level);
    const result = fillVerdict(value, expected);
    setVerdict(result);
    if (result === 'right') record(1, level);
    else askTutorAboutMiss(guideId, question, value.trim());
  }
  function decide(points, selfMarked = false) {
    if (credit !== null) return;
    record(points, confidence, selfMarked);
    setAdvancing(true);
  }
  return { verdict, credit, confidence, reveal, decide };
}

// What shows once a typed answer is checked and isn't plainly right: the student's choice.
function TypedDecision({ verdict, expected, label, onDecide, onExplain, onRemember }) {
  if (verdict === 'close') {
    return (
      <>
        <p className="retain-feedback partial" role="status">Almost. The full answer is <strong>{choiceText(expected)}</strong>. Does yours mean the same?</p>
        <div className="quiz-next-row">
          <RememberButton onRemember={onRemember} />
          <button type="button" className="c-btn c-btn--secondary" onClick={() => onDecide(0)}>Count it wrong</button>
          <button type="button" className="c-btn c-btn--primary quiz-next" onClick={() => onDecide(1, true)} autoFocus>Count it right</button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="retain-feedback wrong" role="status">{label}: <strong>{expected}</strong></p>
      <div className="quiz-next-row">
        {onExplain !== null && <AskWhy onExplain={onExplain} />}
        <RememberButton onRemember={onRemember} />
        <button type="button" className="c-btn c-btn--secondary" onClick={() => onDecide(1, true)}>I was right</button>
        <button type="button" className="c-btn c-btn--primary quiz-next" onClick={() => onDecide(0)} autoFocus>Next</button>
      </div>
    </>
  );
}

const verdictClass = verdict => (verdict === 'right' ? ' right' : verdict === 'close' ? ' partial' : verdict === 'wrong' ? ' wrong' : '');

export function FillCard({ card, question, guideId, onResult, onNext, askSure = true }) {
  const answer = conceptAnswer(question);
  const [value, setValue] = useState('');
  const [asking, setAsking] = useState(false);
  const [explained, setExplained] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const timing = useAnswerTiming();
  const typed = useTypedAnswer({ card, question, guideId, onResult, onNext, expected: answer, value, timing });

  function check(event) {
    event.preventDefault();
    if (typed.verdict !== null || !value.trim()) return;
    timing.done();
    // First asks get "How sure?" before the answer shows; repeats go straight to it.
    if (card.reask || !askSure) typed.reveal();
    else setAsking(true);
  }

  return (
    <form onSubmit={check}>
      <div className="quiz-question-text">{question.question}</div>
      <div className="retain-fill-row">
        <input
          className={'retain-fill-input' + verdictClass(typed.verdict)}
          value={value}
          onChange={event => setValue(event.target.value)}
          onKeyDown={timing.key}
          placeholder="Type the answer"
          aria-label="Your answer"
          readOnly={typed.verdict !== null || asking}
          autoFocus
          autoComplete="off"
        />
        {typed.verdict === null && !asking && <button type="submit" className="c-btn c-btn--primary" disabled={!value.trim()}>Check</button>}
      </div>
      {asking && <ConfidencePrompt onPick={level => { setAsking(false); typed.reveal(level); }} />}
      {typed.verdict === 'right' && <p className="retain-feedback right" role="status">Right: <strong>{answer}</strong></p>}
      {explained && <MissFeedback guideId={guideId} card={card} question={question} chosen={value.trim()} sure={typed.confidence === 'sure'} />}
      {remembering && <MemoryHook guideId={guideId} concept={card.concepts[0]} question={question} />}
      {typed.verdict === 'right' && <NextButton onNext={onNext} missed={false} />}
      {(typed.verdict === 'close' || typed.verdict === 'wrong') && typed.credit === null && (
        <TypedDecision verdict={typed.verdict} expected={answer} label="Answer" onDecide={typed.decide} onExplain={explained ? null : () => setExplained(true)} onRemember={remembering ? null : () => setRemembering(true)} />
      )}
    </form>
  );
}

// Fill the blank: the answer with its key word missing (learnEngine.makeCloze); the student types
// the word. An answer too short to blank is asked whole.
export function ClozeCard({ card, question, guideId, onResult, onNext, askSure = true, blank = null }) {
  // blank: { before, missing, after } picked when the guide was built (learnLadder.blankFor).
  const cloze = useMemo(() => blank || makeCloze(conceptAnswer(question)), [question, blank]);
  const [value, setValue] = useState('');
  const [asking, setAsking] = useState(false);
  const [explained, setExplained] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const timing = useAnswerTiming();
  const typed = useTypedAnswer({ card, question, guideId, onResult, onNext, expected: cloze?.missing || '', value, timing });
  if (!cloze) return <FillCard card={card} question={question} guideId={guideId} onResult={onResult} onNext={onNext} askSure={askSure} />;

  function check(event) {
    event.preventDefault();
    if (typed.verdict !== null || !value.trim()) return;
    timing.done();
    if (card.reask || !askSure) typed.reveal();
    else setAsking(true);
  }

  return (
    <form onSubmit={check}>
      <div className="quiz-question-text">{question.question}</div>
      <p className="retain-cloze">
        {cloze.before}
        <span className={'retain-cloze-blank' + verdictClass(typed.verdict)}>{typed.verdict === null ? <span aria-label="missing word">______</span> : cloze.missing}</span>
        {cloze.after}
      </p>
      <div className="retain-fill-row">
        <input
          className={'retain-fill-input' + verdictClass(typed.verdict)}
          value={value}
          onChange={event => setValue(event.target.value)}
          onKeyDown={timing.key}
          placeholder={cloze.missing.includes(' ') ? 'The missing words' : 'The missing word'}
          aria-label={cloze.missing.includes(' ') ? 'The missing words' : 'The missing word'}
          readOnly={typed.verdict !== null || asking}
          autoFocus
          autoComplete="off"
        />
        {typed.verdict === null && !asking && <button type="submit" className="c-btn c-btn--primary" disabled={!value.trim()}>Check</button>}
      </div>
      {asking && <ConfidencePrompt onPick={level => { setAsking(false); typed.reveal(level); }} />}
      {typed.verdict === 'right' && <p className="retain-feedback right" role="status">Right: <strong>{cloze.missing}</strong></p>}
      {explained && <MissFeedback guideId={guideId} card={card} question={question} chosen={value.trim()} sure={typed.confidence === 'sure'} />}
      {remembering && <MemoryHook guideId={guideId} concept={card.concepts[0]} question={question} />}
      {typed.verdict === 'right' && <NextButton onNext={onNext} missed={false} />}
      {(typed.verdict === 'close' || typed.verdict === 'wrong') && typed.credit === null && (
        <TypedDecision verdict={typed.verdict} expected={cloze.missing} label="The word" onDecide={typed.decide} onExplain={explained ? null : () => setExplained(true)} onRemember={remembering ? null : () => setRemembering(true)} />
      )}
    </form>
  );
}

// Drag an answer onto its question, or tap an answer and then tap the question (phones).
export function MatchingCard({ card, questions, guideId, onResult, onNext }) {
  const rows = card.concepts.map(index => ({ index, question: questions[index], answer: conceptAnswer(questions[index]) }));
  const [bank] = useState(() => shuffled(rows.map(row => row.answer), card.id));
  const [placed, setPlaced] = useState({});
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const used = new Set(Object.values(placed));
  const timing = useAnswerTiming();

  function place(index, answer) {
    if (checked || !answer) return;
    setPlaced(current => {
      const next = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== answer));
      next[index] = answer;
      return next;
    });
    setPicked(null);
  }

  function clear(index) {
    if (checked) return;
    setPlaced(current => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function check() {
    setChecked(true);
    const time = timing.done(); // one time for the whole set of pairs
    const results = rows.map(row => {
      const right = normalize(placed[row.index]) === normalize(row.answer);
      return { concept: row.index, credit: right ? 1 : 0, response: placed[row.index] || '', timing: time, nOptions: bank.length };
    });
    const miss = rows.find((row, i) => results[i].credit !== 1);
    if (miss) askTutorAboutMiss(guideId, miss.question, placed[miss.index] || '(no match)', bank);
    onResult(results);
  }

  return (
    <>
      <div className="quiz-question-text">Match</div>
      <div className="retain-match-bank" aria-label="Answers">
        {bank.filter(answer => !used.has(answer)).map(answer => (
          <button
            key={answer}
            type="button"
            className={'retain-chip' + (picked === answer ? ' picked' : '')}
            draggable={!checked}
            onDragStart={event => event.dataTransfer.setData('text/plain', answer)}
            onClick={() => setPicked(picked === answer ? null : answer)}
            aria-pressed={picked === answer}
          >{answer}</button>
        ))}
      </div>
      <ol className="retain-match-rows">
        {rows.map(row => {
          const value = placed[row.index];
          const state = !checked ? '' : normalize(value) === normalize(row.answer) ? ' right' : ' wrong';
          return (
            <li key={row.index} className={'retain-match-row' + state}>
              <span>{row.question.question}</span>
              <button
                type="button"
                className={'retain-slot' + (value ? ' filled' : '') + (picked ? ' ready' : '')}
                onClick={() => (picked ? place(row.index, picked) : clear(row.index))}
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); place(row.index, event.dataTransfer.getData('text/plain')); }}
                aria-label={value ? `Answer: ${value}. Tap to remove.` : 'Empty. Tap after choosing an answer.'}
              >{value || 'Drop here'}</button>
              {checked && state === ' wrong' && <small className="retain-correct-answer">Answer: {row.answer}</small>}
            </li>
          );
        })}
      </ol>
      {!checked
        ? <button type="button" className="c-btn c-btn--primary retain-check" onClick={check} disabled={Object.keys(placed).length !== rows.length}>Check</button>
        : <NextButton onNext={onNext} missed={rows.some(row => normalize(placed[row.index]) !== normalize(row.answer))} />}
    </>
  );
}

const VERDICTS = { 1: ['right', 'Right'], 0.5: ['partial', 'Partly right'], 0: ['wrong', 'Not quite'] };

export function WrittenCard({ card, question, guideId, onResult, onNext, onSwitch }) {
  const quietLimit = useContext(QuietLimits);
  const concept = card.concepts[0];
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState(null);
  const [error, setError] = useState('');
  const [remembering, setRemembering] = useState(false);
  const timing = useAnswerTiming();

  async function check(event) {
    event.preventDefault();
    if (busy || grade || !value.trim()) return;
    const time = timing.done(); // the answer, not the grading round trip
    setBusy(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/grade`, {
      method: 'POST',
      quietLimit,
      body: JSON.stringify({ concept, answer: value.trim() }),
    });
    setBusy(false);
    // Out of AI checks inside a ladder round: straight to the self-check, no dialog.
    if (quietLimit && data?.limit_reached && onSwitch) {
      onSwitch('self');
      return;
    }
    if (typeof data?.credit !== 'number') {
      setError(data?.detail || 'Cordia could not check this answer right now.');
      return;
    }
    setGrade(data);
    if (data.credit !== 1) askTutorAboutMiss(guideId, question, value.trim());
    onResult([{ concept, credit: data.credit, response: value.trim(), token: data.token, timing: time, answerChars: value.trim().length }]);
  }

  const [tone, label] = grade ? VERDICTS[grade.credit] : [];
  return (
    <form onSubmit={check}>
      <div className="quiz-question-text">{question.question}</div>
      <textarea
        className="retain-written-input"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={timing.key}
        placeholder="Your answer"
        aria-label="Your answer"
        rows={4}
        readOnly={Boolean(grade) || busy}
        maxLength={4000}
        autoFocus
      />
      {!grade && (
        <div className="retain-written-actions">
          <button type="submit" className="c-btn c-btn--primary" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Check'}</button>
          {error && (
            <>
              <span className="retain-action-error" role="alert">{error}</span>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => onSwitch('mc')}>Use choices</button>
            </>
          )}
        </div>
      )}
      {grade && (
        <div className={'retain-feedback ' + tone} role="status">
          <strong>{label}.</strong>{grade.explanation ? ` ${grade.explanation}` : ''}
          {grade.credit !== 1 && <p className="retain-guide-answer"><span>Answer</span>{grade.answer}</p>}
        </div>
      )}
      {remembering && <MemoryHook guideId={guideId} concept={concept} question={question} />}
      {grade && <NextButton onNext={onNext} missed={grade.credit !== 1} onRemember={remembering ? null : () => setRemembering(true)} />}
    </form>
  );
}
