import { getProgress, markUsed, updateProgress } from './progress';

// Interactive walkthroughs. Each step spotlights one real control and moves on only
// when the student does the real action, reported here with walkthroughEvent(name).
export const WT_EVENT = 'cordia:wt';

const onGuide = path => path === '/guide/[id]';
const onQuiz = path => path === '/quiz/[guideId]';
const onCards = path => path === '/flashcards/study';
const onToday = path => path === '/dashboard';

// Day one: 9 steps (dots), some with a few sub-steps.
export const DAY_ONE = [
  [{ id: 'about', screen: 'about', where: onToday, on: 'about-done' }],
  [
    { id: 'new', target: '[data-spot="new"]', label: 'Tap New', on: 'new-opened' },
    { id: 'new-pick', target: '[data-spot="new-options"]', label: 'Pick one', on: 'guide-building' },
  ],
  [{ id: 'build', target: '[data-spot="new-headings"]', label: 'Building', on: 'guide-ready', passive: true }],
  [
    { id: 'explain', target: '[data-spot="explain"]', label: 'Tap Explain', where: onGuide, on: 'explain' },
    { id: 'explain-close', target: '[data-spot="tutor-close"]', label: 'Close Tutor', on: 'tutor-closed', optionalTarget: true },
  ],
  [
    { id: 'highlight', target: '[data-spot="reader-text"]', label: 'Highlight any text', where: onGuide, on: 'selection' },
    { id: 'make-card', target: '[data-spot="make-card"]', label: 'Tap Make card', on: 'make-card-open' },
    { id: 'card-save', target: '[data-spot="card-save"]', label: 'Save card', on: 'card-made' },
  ],
  [
    { id: 'quiz', target: '[data-spot="quiz-pill"]', label: 'Tap Quiz', where: onGuide, on: 'quiz-opened' },
    { id: 'quiz-start', target: '[data-spot="quiz-start"]', label: '3 questions', where: onQuiz, on: 'quiz-started' },
    { id: 'quiz-answer', where: onQuiz, on: 'quiz-done', passive: true },
  ],
  [
    { id: 'ask', target: '[data-spot="ask-why"]', label: 'Tap Ask', where: onQuiz, on: 'ask' },
    { id: 'ask-close', target: '[data-spot="tutor-close"]', label: 'Close Tutor', on: 'tutor-closed', optionalTarget: true },
  ],
  [
    { id: 'quiz-back', target: '[data-spot="quiz-done"]', label: 'Back to guide', where: onQuiz, on: 'guide-open' },
    { id: 'cards', target: '[data-spot="cards-pill"]', label: 'Tap Cards', where: onGuide, on: 'cards-opened' },
    { id: 'flip', target: '[data-spot="flashcard"]', label: 'flip', where: onCards, on: 'card-flipped' },
  ],
  [
    { id: 'today', target: '[data-spot="nav-today"]', label: 'Go to Today', on: 'today-opened' },
    { id: 'start', target: '[data-spot="start"]', label: 'Come back daily', where: onToday, on: 'start', finishable: true },
  ],
];

// Short walkthroughs for each feature, started from a dot, Learn Cordia or Help.
export const MINI = {
  add: { label: 'Add material', route: '/dashboard', steps: [
    { target: '[data-spot="new"]', label: 'Tap New', on: 'new-opened' },
    { target: '[data-spot="new-options"]', label: 'Pick one', on: 'guide-building' },
  ] },
  explain: { label: 'Explain', route: 'guide', steps: [
    { target: '[data-spot="explain"]', label: 'Tap Explain', where: onGuide, on: 'explain' },
  ] },
  card: { label: 'Make card', route: 'guide', steps: [
    { target: '[data-spot="reader-text"]', label: 'Highlight any text', where: onGuide, on: 'selection' },
    { target: '[data-spot="make-card"]', label: 'Tap Make card', on: 'make-card-open' },
    { target: '[data-spot="card-save"]', label: 'Save card', on: 'card-made' },
  ] },
  quiz: { label: 'Quiz', route: 'guide', steps: [
    { target: '[data-spot="quiz-pill"]', label: 'Tap Quiz', where: onGuide, on: 'quiz-opened' },
    { target: '[data-spot="quiz-start"]', label: 'Tap Start', where: onQuiz, on: 'quiz-started' },
  ] },
  ask: { label: 'Tutor', route: 'guide', steps: [
    { target: '[data-spot="ask-pill"]', label: 'Tap Ask', where: onGuide, on: 'ask' },
  ] },
  cards: { label: 'Cards', route: 'guide', steps: [
    { target: '[data-spot="cards-pill"]', label: 'Tap Cards', where: onGuide, on: 'cards-opened' },
    { target: '[data-spot="flashcard"]', label: 'flip', where: onCards, on: 'card-flipped' },
  ] },
  practice: { label: 'Practice', route: '/dashboard', steps: [
    { target: '[data-spot="tool-practice"]', label: 'Tap Practice', where: onToday, on: 'practice-opened' },
    { target: '[data-spot="practice-picker"]', label: 'Pick a guide', where: path => path === '/practice', on: 'practice-guide' },
    { target: '[data-spot="practice-canvas"]', label: 'Show your work', where: path => path === '/practice/[guideId]', on: 'practice-drew' },
  ] },
  calendar: { label: 'Calendar', route: '/dashboard', steps: [
    { target: '[data-spot="nav-calendar"]', label: 'Open Calendar', on: 'calendar-opened' },
    { target: '[data-spot="calendar-feed"]', label: 'Paste link', where: path => path === '/calendar', on: 'calendar-connected' },
  ] },
  focus: { label: 'Focus', route: '/dashboard', steps: [
    { target: '[data-spot="focus-start"]', label: 'Start focus', where: onToday, on: 'focus-started' },
  ] },
  notes: { label: 'Notes', route: '/dashboard', steps: [
    { target: '[data-spot="nav-notes"]', label: 'Open Notes', on: 'notes-opened' },
    { target: '[data-spot="note-new"]', label: 'New note', where: path => path === '/smartnotes', on: 'note-created' },
  ] },
  insights: { label: 'Insights', route: '/dashboard', steps: [
    { target: '[data-spot="insights"]', label: 'Your weak spots', where: onToday, on: 'insights-opened' },
  ] },
  grove: { label: 'Grove', route: '/dashboard', steps: [
    { target: '[data-spot="grove"]', label: 'Your grove', where: onToday, on: 'grove-opened' },
  ] },
};

// Which real action counts as using each feature (ticks Learn Cordia, hides its dot).
const FEATURE_EVENTS = {
  'guide-ready': 'add', explain: 'explain', 'card-made': 'card', 'quiz-started': 'quiz', ask: 'ask',
  'card-flipped': 'cards', 'practice-opened': 'practice', 'calendar-connected': 'calendar-connected', 'focus-started': 'focus',
  'note-written': 'note-written', 'insights-opened': 'insights', 'grove-opened': 'grove',
};

export const FEATURES = Object.keys(MINI);

export function walkthroughEvent(name, detail = {}) {
  if (typeof window === 'undefined') return;
  markUsed(FEATURE_EVENTS[name]);
  window.dispatchEvent(new CustomEvent(WT_EVENT, { detail: { name, ...detail } }));
}

export function currentWalkthrough() {
  const wt = getProgress().wt;
  return wt && wt.status === 'active' ? wt : null;
}

// The step definition for the active walkthrough, or null.
export function activeStep(wt = currentWalkthrough()) {
  if (!wt) return null;
  if (wt.id === 'day1') {
    const step = DAY_ONE[wt.step];
    return step ? { ...step[wt.sub || 0], index: wt.step, total: DAY_ONE.length } : null;
  }
  const mini = MINI[wt.id];
  const step = mini?.steps[wt.step];
  return step ? { ...step, index: wt.step, total: mini.steps.length } : null;
}

export function inDayOne(stepId) {
  const wt = currentWalkthrough();
  return Boolean(wt && wt.id === 'day1' && activeStep(wt)?.id === stepId);
}

export function startWalkthrough(id) {
  updateProgress(() => ({ wt: { id, step: 0, sub: 0, status: 'active' } }));
}

export function setWalkthrough(wt) {
  updateProgress(() => ({ wt }));
}

export function endWalkthrough(status = 'done') {
  const wt = getProgress().wt;
  if (!wt) return;
  updateProgress(current => ({
    wt: null,
    done: [...new Set([...current.done, wt.id])],
    ...(wt.id === 'day1' ? { day1Status: status } : {}),
  }));
}

export function dayOneFinished(progress = getProgress()) {
  return Boolean(progress.day1Status);
}
