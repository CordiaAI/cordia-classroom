import { useEffect, useRef, useState } from 'react';
import CordiaLoader, { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import { apiFetch, openUpgrade } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { LEARN_LADDER_V2 } from '../../lib/featureFlags';
import useSessionTracker from '../../lib/useSessionTracker';
import { PRO_TYPES, TYPE_LABELS } from '../../lib/retainEngine.mjs';
import { ArrowLeft, Lock, ListChecks, Minus, PenLine, Play, Plus, RefreshCw, Repeat, TextCursorInput, Shuffle as PairsIcon, Timer } from 'lucide-react';
import { parseQAPairs } from '../../lib/formatters';
import { clampCount, minutesFor, quizLimit, recommendedCount } from '../../lib/quizLength.mjs';
import MatchRace from '../../components/MatchRace';
import QuizMode from '../../components/QuizMode';
import SubmitFlow from '../../components/SubmitFlow';
import FeedbackChoice, { useFeedbackChoice } from '../../components/FeedbackChoice';
import { inDayOne, walkthroughEvent } from '../../lib/walkthrough';
import { spreadCards } from '../../lib/checkYourself';
import { needsStudySet } from '../../lib/studySet.mjs';
import { makeStudySet } from '../../lib/autoStudySet';
import { loadStudyGuide } from '../../lib/studyGuide';
import UpdateAvailable, { GuideUnavailable } from '../../components/UpdateAvailable';
import { clearResume, readResume, writeResume } from '../../lib/resume';

// Short tile names; TYPE_LABELS stays the engine's own naming.
const MODES = {
  mc: { label: 'Choice', icon: ListChecks },
  written: { label: 'Written', icon: PenLine },
  fill: { label: 'Fill in', icon: TextCursorInput },
  matching: { label: 'Pairs', icon: PairsIcon },
};
const STORAGE_KEY = 'retainTypes';
const listTypes = types => types.map(type => MODES[type]?.label || type).join(' and ');

// Learn's Final check in the last days before a test (LEARN_LADDER_V2) links ?types=mc,fill etc. so
// the quiz leans to the test's format; used for this visit only, never saved over the student's picks.
function linkedTypes(query) {
  if (!LEARN_LADDER_V2 || typeof query !== 'string') return null;
  const picked = [...new Set(query.split(',').filter(type => TYPE_LABELS[type] && type !== 'matching'))];
  return picked.length ? picked : null;
}

function rememberedTypes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const valid = Array.isArray(saved) ? saved.filter(type => TYPE_LABELS[type]) : [];
    return valid.length ? valid : ['mc'];
  } catch {
    return ['mc'];
  }
}

export default function QuizPage() {
  const router = useRouter();
  const { guideId } = router.query;
  // ?check=1: a new guide's "Check yourself", five quick questions that start on their own.
  const check = router.query.check === '1';
  const { ready } = useRequireAuth();
  useSessionTracker('quiz', typeof guideId === 'string' ? guideId : null); // active time only
  const [types, setTypes] = useState(['mc']);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  // A quiz left mid-way (a refresh) that QuizMode picks up again.
  const [resumed, setResumed] = useState(null);
  const [starting, setStarting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [title, setTitle] = useState('');
  const [race, setRace] = useState(false);
  // "Show if I'm right": after each question (default) or when the whole quiz is submitted.
  const [feedback, setFeedback] = useFeedbackChoice('quiz');
  const [loaded, setLoaded] = useState(false);
  const [making, setMaking] = useState(false);
  // Someone else's shared guide (Stage 4): your own attempts and allowance; no owner actions.
  const [viewer, setViewer] = useState(null);
  const [gone, setGone] = useState(null);
  const [reload, setReload] = useState(0);
  // How many questions: the student picks (1 to the limit), starting at the recommendation.
  const [available, setAvailable] = useState(0);
  const [count, setCount] = useState(0);
  const [countText, setCountText] = useState('');

  useEffect(() => {
    if (!ready || !guideId) return;
    setTypes(linkedTypes(router.query.types) || rememberedTypes());
    const pending = check ? null : readResume('quiz', guideId);
    if (pending?.page && pending.quiz) {
      setSession(pending.page);
      setResumed(pending.quiz);
    }
    // Title, past scores and plan arrive together, so the page appears once, whole.
    const safe = promise => promise.catch(() => null);
    Promise.all([safe(apiFetch(`/quiz/${guideId}/history`)), safe(loadStudyGuide(guideId)), safe(apiFetch('/billing/status'))]).then(async ([past, guide, billing]) => {
      setHistory(past?.attempts || []);
      setTitle(guide?.guide?.title || '');
      setViewer(guide?.guide?.viewer || null);
      if (guide?.unavailable) setGone(guide);
      // The saved quiz's size, or its Q/A pairs before one is built (a quiz uses at most the first 50).
      const saved = Array.isArray(guide?.guide?.quiz_questions) ? guide.guide.quiz_questions.length : 0;
      const pairs = saved || parseQAPairs(guide?.guide?.study_guide || '').length;
      setAvailable(pairs);
      setCount(recommendedCount(pairs));
      setCountText(String(recommendedCount(pairs)));
      if (billing?.features) setPlan({ pro: billing.plan === 'classroom_plus' || billing.unlimited, left: billing.features.retain_types?.remaining ?? 0 });
      setLoaded(true);
      // Notes without questions yet (a Canvas import): the questions are made from them first.
      if (!guide?.guide?.viewer && needsStudySet(guide?.guide)) {
        setMaking(true);
        const made = await makeStudySet(guide.guide);
        setMaking(false);
        if (made.error) setError(made.error);
      }
    });
  }, [ready, guideId, reload]);
  const gate = useLoadGate(loaded);

  // Learn's Match opens it straight away (?mode=match).
  useEffect(() => { if (router.query.mode === 'match') setRace(true); }, [router.query.mode]);

  const proLocked = plan && !plan.pro && plan.left <= 0;

  // A remembered Pro type the account can no longer use is turned off rather than failing on Start.
  useEffect(() => {
    // A linked Final check without Fill in the blank left uses Written instead, as Learn does.
    if (proLocked && linkedTypes(router.query.types)) {
      setTypes(current => [...new Set(current.map(type => (type === 'fill' ? 'written' : type)).filter(type => !PRO_TYPES.includes(type)))]);
      return;
    }
    if (proLocked) setTypes(current => (current.some(type => !PRO_TYPES.includes(type)) ? current.filter(type => !PRO_TYPES.includes(type)) : ['mc']));
  }, [proLocked]);

  function toggle(type) {
    if (PRO_TYPES.includes(type) && proLocked && !types.includes(type)) {
      openUpgrade({ feature: 'retain_types' });
      return;
    }
    const next = types.includes(type) ? types.filter(item => item !== type) : [...types, type];
    setTypes(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* remembering is optional */ }
  }

  useEffect(() => { if (ready && guideId) walkthroughEvent('quiz-opened'); }, [ready, guideId]);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!ready || !guideId || !check || autoStarted.current) return;
    autoStarted.current = true;
    start();
  }, [ready, guideId, check]);
  const guideHref = (viewer ? '/sets/' : '/guide/') + guideId;
  const toGuide = () => router.push(guideHref);

  async function start() {
    setStarting(true);
    setError('');
    // The day-one walkthrough runs a short 3-question multiple-choice round.
    const short = inDayOne('quiz-start');
    const chosen = short || race || check ? ['mc'] : types;
    // A chosen size asks that many questions picked at random; the order is always shuffled.
    const sized = !short && !race && !check && count > 0 && count < quizLimit(available);
    const data = await apiFetch(`/quiz/${guideId}/session`, { method: 'POST', body: JSON.stringify({ types: chosen, ...(sized ? { count } : {}) }) });
    setStarting(false);
    // No questions to check (a notes page, or the quiz couldn't be built): straight to reading.
    if (check && !data?.cards?.length) { router.replace('/guide/' + guideId); return; }
    if (check) data.cards = spreadCards(data.cards);
    if (data?.cards?.length) {
      // Short-answer types (Fill in, Pairs) the student picked that no question here could use.
      const unused = chosen.filter(type => PRO_TYPES.includes(type) && Array.isArray(data.types) && !data.types.includes(type));
      setResumed(null);
      setSession({ ...data, cards: short ? data.cards.slice(0, 3) : data.cards, selected: chosen, unused, race: race && !short, version: Date.now(), feedback: short || race || check ? 'each' : feedback });
      walkthroughEvent('quiz-started');
    }
    else setError(data?.detail || 'The quiz could not start. Make sure this guide has questions and answers.');
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/regenerate`, { method: 'POST' });
    setRegenerating(false);
    if (data?.questions) {
      clearResume('quiz', guideId);
      setSession(null);
    }
    else setError(data?.detail || 'Could not regenerate the questions.');
  }

  function changeCount(value) {
    const next = clampCount(value, available);
    setCount(next);
    setCountText(String(next));
  }

  const limit = quizLimit(available);
  const recommended = recommendedCount(available);

  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading quiz" />;
  if (gone) return <GuideUnavailable title={gone.title} reason={gone.unavailable} />;
  return (
    <Reveal phase={gate}>
    <div className="c-page quiz-page">
      <header className="c-page-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={toGuide} aria-label="Back to guide"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <h1 className="c-title">{check ? 'Check yourself' : 'Quiz'}</h1>
        </div>
        {check ? (
          <button type="button" className="c-btn c-btn--quiet" onClick={toGuide}>Skip to reading</button>
        ) : viewer ? null : (
          <button type="button" className="c-btn c-btn--quiet" onClick={regenerate} disabled={regenerating || starting}>
            <RefreshCw size={20} strokeWidth={1.75} aria-hidden="true" />{regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
      </header>
      {title && <p className="c-section-title quiz-guide">{title}</p>}
      {viewer && !session && <UpdateAvailable guideId={guideId} viewer={viewer} onChanged={() => setReload(n => n + 1)} />}
      {check && <p className="c-meta quiz-check-note">Five quick questions before you read. It doesn't count, and mistakes help you learn.</p>}
      {error && <div className="retain-action-error" role="alert">{error}</div>}

      {session?.race ? (
        <MatchRace key={session.version} questions={session.questions} guideId={guideId} onRestart={() => setSession(null)} onDone={toGuide} />
      ) : session ? (
        <>
        {session.unused?.length > 0 && (
          <p className="quiz-unused" role="status">
            {listTypes(session.unused)} only {session.unused.length === 1 ? 'works' : 'work'} with answers of a few words, and this guide doesn't have enough of them, so {session.unused.length === 1 ? "it isn't" : "they aren't"} used here.
          </p>
        )}
        {session.feedback === 'submit' ? (
          <SubmitFlow
            key={session.version}
            questions={session.questions}
            cards={session.cards}
            selected={session.selected}
            guideId={guideId}
            resume={resumed?.feedback === 'submit' ? resumed : null}
            onProgress={snapshot => (snapshot ? writeResume('quiz', guideId, { page: session, quiz: snapshot }) : clearResume('quiz', guideId))}
            onRestart={() => setSession(null)}
            onDone={() => { walkthroughEvent('guide-open'); router.push('/guide/' + guideId); }}
          />
        ) : (
        <QuizMode
          key={session.version}
          questions={session.questions}
          cards={session.cards}
          types={session.selected}
          guideId={guideId}
          onRestart={() => (check ? start() : setSession(null))}
          onDone={() => { walkthroughEvent('guide-open'); toGuide(); }}
          doneLabel={check ? 'Read the guide' : undefined}
          mode={check ? 'check' : 'quiz'}
          resume={resumed}
          onProgress={check ? undefined : snapshot => (snapshot ? writeResume('quiz', guideId, { page: session, quiz: snapshot }) : clearResume('quiz', guideId))}
        />
        )}
        </>
      ) : making ? (
        <div className="quiz-check-wait"><CordiaLoader size={28} label="Making questions from your notes" /><span className="c-meta">Making questions from your notes…</span></div>
      ) : check ? (
        <div className="quiz-check-wait"><CordiaLoader size={28} label="Getting your questions ready" /><span className="c-meta">Getting your questions ready…</span></div>
      ) : (
        <>
          <div className="c-seg quiz-switch" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={!race} className={!race ? 'is-active' : ''} onClick={() => setRace(false)}>Quiz</button>
            <button type="button" role="tab" aria-selected={race} className={race ? 'is-active' : ''} data-spot="match-tab" onClick={() => { setRace(true); walkthroughEvent('match-opened'); }}>Match</button>
          </div>
          {!race && <div className="quiz-modes" role="group" aria-label="Question types">
            {Object.keys(TYPE_LABELS).map(type => {
              const mode = MODES[type];
              const locked = PRO_TYPES.includes(type) && plan && !plan.pro && plan.left <= 0;
              const on = types.includes(type);
              return (
                <button key={type} type="button" className={'quiz-mode' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => toggle(type)} aria-label={`${mode.label}${locked ? ', Pro' : ''}`}>
                  <mode.icon size={28} strokeWidth={1.75} aria-hidden="true" />
                  <span>{mode.label}</span>
                  {PRO_TYPES.includes(type) && plan && !plan.pro && <Lock className="quiz-lock" size={16} strokeWidth={1.75} aria-hidden="true" />}
                </button>
              );
            })}
          </div>}
          {!race && limit > 1 && (
            <div className="quiz-count" role="group" aria-labelledby="quiz-count-label">
              <span id="quiz-count-label" className="quiz-count-label">Questions</span>
              <div className="quiz-count-step">
                <button type="button" className="c-icon-btn" onClick={() => changeCount(count - 1)} disabled={count <= 1} aria-label="Fewer questions"><Minus size={20} strokeWidth={1.75} aria-hidden="true" /></button>
                <input
                  className="c-input quiz-count-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={limit}
                  value={countText}
                  onChange={event => setCountText(event.target.value)}
                  onBlur={() => changeCount(countText)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); changeCount(countText); } }}
                  aria-label={`Number of questions, 1 to ${limit}`}
                />
                <button type="button" className="c-icon-btn" onClick={() => changeCount(count + 1)} disabled={count >= limit} aria-label="More questions"><Plus size={20} strokeWidth={1.75} aria-hidden="true" /></button>
              </div>
              <span className="c-meta">of {limit}{available > limit ? ' (the most a quiz asks)' : ''} · {minutesFor(count)}</span>
              {count === recommended
                ? <span className="quiz-count-rec">Recommended</span>
                : <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => changeCount(recommended)}>Use recommended ({recommended})</button>}
            </div>
          )}
          {!race && <FeedbackChoice value={feedback} onChange={setFeedback} id="quiz-feedback" />}
          <p className="quiz-note">{race ? <><Timer size={20} strokeWidth={1.75} aria-hidden="true" />Match questions to answers in 60 seconds</> : <><Repeat size={20} strokeWidth={1.75} aria-hidden="true" />{feedback === 'submit' ? 'Shuffled. Answers show when you submit; then retry your misses.' : 'Shuffled. Misses repeat.'}</>}</p>
          <button type="button" className="c-btn c-btn--primary c-btn--lg quiz-start" data-spot="quiz-start" onClick={start} disabled={starting || !types.length || !guideId}>
            {starting ? <><CordiaLoader size={20} label="Preparing" />Preparing</> : <><Play size={20} strokeWidth={1.75} aria-hidden="true" />Start</>}
          </button>
          {history.length > 0 && (
            <section className="c-section" aria-labelledby="quiz-history">
              <h2 id="quiz-history" className="c-section-title">Past</h2>
              <div className="c-card c-list">
                {history.map(attempt => (
                  <div key={attempt.id} className="c-list-row">
                    <span className="c-grow quiz-past-score">{attempt.score}%</span>
                    <span className="c-meta">{attempt.correct_answers}/{attempt.total_questions}</span>
                    <span className="c-meta">{new Date(attempt.completed_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <style jsx>{`
        .quiz-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        .quiz-page :global(.quiz-question-card) { width: min(720px, 100%); justify-self: center; }
        .quiz-guide { margin: -12px 0 0; font-family: var(--font-sans); }
        .quiz-switch { justify-self: start; }
        .quiz-unused { margin: 0 0 12px; color: var(--muted); font: 500 var(--fs-13)/var(--lh-body) var(--font-sans); }
        .quiz-check-note { margin: -8px 0 4px; }
        .quiz-check-wait { display: grid; justify-items: center; gap: 12px; padding: 48px 0; }
        .quiz-modes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .quiz-mode { position: relative; display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 120px; border: 1px solid var(--line); border-radius:var(--r-card); background: var(--card); color: var(--ink); font:600 15px/1 var(--font-sans); cursor: pointer; box-shadow: var(--shadow); }
        .quiz-mode :global(.lucide) { color: var(--olive-ink); }
        .quiz-mode.is-on { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .quiz-mode :global(.quiz-lock) { position: absolute; top: 12px; right: 12px; color: var(--muted); }
        .quiz-note { display: flex; align-items: center; gap: 8px; margin: 0; font-weight:600; }
        .quiz-note :global(.lucide) { color: var(--olive-ink); }
        .quiz-start { justify-self: start; min-width: 180px; }
        .quiz-count { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
        .quiz-count-label { font: 600 15px/1.2 var(--font-sans); color: var(--ink); }
        .quiz-count-step { display: inline-flex; align-items: center; gap: 6px; }
        .quiz-count-input { width: 72px; text-align: center; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
        .quiz-count-input::-webkit-outer-spin-button, .quiz-count-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .quiz-count-rec { padding: 4px 10px; border-radius: var(--r-pill); background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1.2 var(--font-sans); }
        .quiz-past-score { font-weight:600; font-variant-numeric: tabular-nums; }
        @media (max-width: 767px) { .quiz-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); } .quiz-start { width: 100%; } }
      `}</style>
    </div>
    </Reveal>
  );
}
