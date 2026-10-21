import { getProgress, markUsed, updateProgress } from './progress';

// Interactive walkthroughs. Each step spotlights one real control and moves on only
// when the student does the real action, reported here with walkthroughEvent(name).
export const WT_EVENT = 'cordia:wt';

const onGuide = path => path === '/guide/[id]';
const onQuiz = path => path === '/quiz/[guideId]';
const onCards = path => path === '/flashcards/study';
const onToday = path => path === '/dashboard';

// First run: four screens, from sign-up to a first answered question. Everything else is
// taught by one-time tips where it is used (lib/tips.js) and "Show me" in Learn Cordia.
export const DAY_ONE = [
  [
    { id: 'new', target: '[data-spot="new"]', label: 'What are you studying?', on: 'new-opened' },
    { id: 'new-pick', target: '[data-spot="new-options"]', label: 'Upload, paste, a link, or a sample', on: 'guide-building' },
  ],
  // While the guide builds, the profile questions fill the wait (Walkthrough shows them).
  [
    { id: 'about', screen: 'about', on: 'about-done' },
    // Moves on when the guide is built (Walkthrough watches the build), opening it.
    { id: 'build', target: '[data-spot="new-headings"]', label: 'Building your guide', passive: true },
  ],
  [
    { id: 'quiz', target: '[data-spot="quiz-pill"]', label: 'Try 3 questions', where: onGuide, on: 'quiz-opened' },
    { id: 'quiz-start', target: '[data-spot="quiz-start"]', label: '3 questions', where: onQuiz, on: 'quiz-started' },
    { id: 'quiz-answer', where: onQuiz, on: 'quiz-done', passive: true },
  ],
  [{ id: 'first-review', screen: 'first-review', on: 'first-run-done' }],
];

// Short walkthroughs for each feature, started from Learn Cordia (Today's first week, and Help).
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
    { target: '[data-spot="ask-pill"]', label: 'Ask the Tutor', where: onGuide, on: 'ask' },
  ] },
  cards: { label: 'Flashcards', route: 'guide', steps: [
    { target: '[data-spot="cards-pill"]', label: 'Tap Flashcards', where: onGuide, on: 'cards-opened' },
    { target: '[data-spot="flashcard"]', label: 'flip', where: onCards, on: 'card-flipped' },
  ] },
  practice: { label: 'Practice', route: '/practice', steps: [
    { target: '[data-spot="practice-picker"]', label: 'Pick a guide', where: path => path === '/practice', on: 'practice-guide' },
    { target: '[data-spot="practice-canvas"]', label: 'Show your work', where: path => path === '/practice/[guideId]', on: 'practice-drew' },
  ] },
  canvas: { label: 'Canvas', route: '/canvas', steps: [
    { target: '[data-spot="canvas-connect"]', label: 'Connect Canvas', where: path => path === '/canvas', on: 'canvas-opened', finishable: true },
  ] },
  calendar: { label: 'Calendar', route: '/canvas?tab=calendar', steps: [
    { target: '[data-spot="calendar-feed"]', label: 'Connect Canvas', where: path => path === '/canvas', on: 'calendar-connected', finishable: true },
  ] },
  focus: { label: 'Focus', route: '/dashboard', steps: [
    { target: '[data-spot="focus-btn"]', label: 'Open the timer', on: 'focus-opened' },
    { target: '[data-spot="focus-start"]', label: 'Start focus', on: 'focus-started' },
  ] },
  // Notes live in a guide's Outline: New › Note makes a page to type in.
  notes: { label: 'Notes', route: '/dashboard', steps: [
    { target: '[data-spot="new"]', label: 'Tap New', on: 'new-opened' },
    { target: '[data-spot="new-note"]', label: 'Tap Note', on: 'note-created' },
    { target: '[data-spot="note-new"]', label: 'Type your notes', where: onGuide, on: 'note-written', finishable: true },
  ] },
  record: { label: 'Record a lecture', route: '/library?filter=lectures', steps: [
    { target: '[data-spot="record-lecture"]', label: 'Tap Record lecture', where: path => path === '/library', on: 'record-opened' },
    { target: '[data-spot="rec-start"]', label: 'Record. Notes write themselves as you go', on: 'recording-started', finishable: true },
  ] },
  visual: { label: 'Visuals', route: 'guide', steps: [
    { target: '[data-spot="note-new"]', label: 'Highlight a line, then tap Visualize', where: onGuide, on: 'visual-added', finishable: true },
  ] },
  match: { label: 'Match', route: 'guide', steps: [
    { target: '[data-spot="quiz-pill"]', label: 'Tap Quiz', where: onGuide, on: 'quiz-opened' },
    { target: '[data-spot="match-tab"]', label: 'Tap Match: pair them up in 60 seconds', where: onQuiz, on: 'match-opened' },
  ] },
  connectors: { label: 'Connectors', route: '/settings?section=connectors', steps: [
    { target: '[data-spot="connectors"]', label: 'Bring in Google Calendar, Drive, Notion and more', where: path => path === '/settings', on: 'connector-opened', finishable: true },
  ] },
  assistant: { label: 'Assistant', route: '/assistant', steps: [
    { target: '[data-spot="assistant"]', label: 'Text Cordia: reminders and quick questions by phone', where: path => path === '/assistant', on: 'assistant-ready', finishable: true },
  ] },
  // A public page outside the app shell: "Show me" just opens it.
  extension: { label: 'Extension', route: '/install-extension', steps: [] },
  insights: { label: 'Insights', route: '/dashboard', steps: [
    { target: '[data-spot="insights"]', label: 'Your progress and weak spots', where: onToday, on: 'insights-opened' },
  ] },
};

// Which real action counts as using each feature (ticks Learn Cordia, hides its dot).
const FEATURE_EVENTS = {
  'guide-ready': 'add', explain: 'explain', 'card-made': 'card', 'quiz-started': 'quiz', ask: 'ask',
  'card-flipped': 'cards', 'practice-opened': 'practice', 'practice-guide': 'practice', 'calendar-connected': 'calendar', 'focus-started': 'focus',
  'note-written': 'notes', 'insights-opened': 'insights', 'canvas-connected': 'canvas',
  'recording-started': 'record', 'visual-added': 'visual', 'match-opened': 'match', 'connector-connected': 'connectors',
  'assistant-ready': 'assistant', 'extension-opened': 'extension',
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
