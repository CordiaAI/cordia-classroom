// A saved quiz question or flashcard is never rewritten: progress, misses and the answer log are keyed
// by its text. The app shows one whose opening only names the source in other words ("According to
// Slide 5, what is X?" asks "What is X?") and never asks one about the source itself ("Which artists
// are listed for Chapter 1?"). The rules are the backend's (services/text_processing.shown_questions
// and shown_cards, the same the app's routes use); this asks it how each quiz question and flashcard
// of the study sets read here is shown and marks them the same way: `shown` (the wording to show) or
// `hidden`, every item in its place.
//
// The backend bounds each request (backend/routers/mcp.py): at most 100 sets, 2,000 texts and
// 200,000 characters, a text at most 2,001 characters. A longer question is sent as its first and last
// 1,000 characters, where its openings are: its `hidden` mark is used, its `shown` wording is not (that
// would lose its middle), so it is asked as saved. A bigger read is split into requests, at most
// MAX_REQUESTS of them, never splitting a set's quiz (packed); a set they don't reach, or whose quiz
// fits no one request, is marked `wording: 'unknown'`, and callers leave it out rather than ask a
// question the app would never ask.
import { conceptAnswer } from '../retainEngine.mjs';

export const MAX_SETS = 100;
export const MAX_TEXTS = 2000;
export const MAX_CHARS = 200000;
const EDGE = 1000;
export const MAX_REQUESTS = 12;

function sent(value) {
  const text = String(value ?? '');
  return text.length > 2 * EDGE ? { text: `${text.slice(0, EDGE)} ${text.slice(-EDGE)}`, cut: true } : { text, cut: false };
}

// Every text to ask about, per set: its quiz questions, then the flashcard fronts its quiz doesn't
// hold (a card with its question's exact words takes that question's mark).
function textsOf(guides) {
  return guides.map(guide => {
    const quiz = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
    const asked = new Set(quiz.map(question => String(question?.question ?? '')));
    const cards = Array.isArray(guide?.flashcards) ? guide.flashcards : [];
    return {
      quiz: quiz.map(question => ({ ...sent(question?.question), answered: Boolean(conceptAnswer(question)) })),
      cards: cards.map((card, index) => ({ card, index }))
        .filter(({ card }) => card && typeof card === 'object' && !asked.has(String(card.front ?? '')))
        .map(({ card, index }) => ({ ...sent(card.front), index })),
    };
  });
}

// The texts packed into requests within the backend's bounds. Each request lists, per set it covers
// (a part), which quiz positions and cards it carries, so the marks go back in place. A set's whole
// quiz goes in one request: the backend applies the quiz-wide rule (none hidden when nothing would be
// left to ask) to what it is sent, so a quiz split in two could show a question the whole quiz hides.
// A quiz too big for any one request is not sent, and its set is marked unknown. Cards are marked
// each on its own (the deck-wide rule is applied here), so they may go in any request.
export function packed(sets) {
  const requests = [];
  let current = null;
  const open = () => { current = { parts: [], texts: 0, chars: 0 }; requests.push(current); };
  const fits = (texts, chars) => current.texts + texts <= MAX_TEXTS && current.chars + chars <= MAX_CHARS;
  open();
  sets.forEach((set, at) => {
    const quizChars = set.quiz.reduce((sum, item) => sum + item.text.length, 0);
    if (set.quiz.length > MAX_TEXTS || quizChars > MAX_CHARS) return;
    let part = null;
    const start = () => {
      if (current.parts.length >= MAX_SETS) open();
      part = { at, quiz: [], cards: [] };
      current.parts.push(part);
    };
    if (set.quiz.length) {
      if (!fits(set.quiz.length, quizChars)) open();
      start();
      set.quiz.forEach((item, position) => part.quiz.push({ ...item, position }));
      current.texts += set.quiz.length;
      current.chars += quizChars;
    }
    set.cards.forEach((item, position) => {
      if (!fits(1, item.text.length)) open();
      if (!part || !current.parts.includes(part)) start();
      part.cards.push({ ...item, position });
      current.texts += 1;
      current.chars += item.text.length;
    });
  });
  return requests.filter(request => request.parts.length);
}

function marked(item, mark, cut) {
  if (!item || typeof item !== 'object') return item;
  const { shown, hidden, ...saved } = item;
  return { ...saved, ...(!cut && typeof mark?.shown === 'string' ? { shown: mark.shown } : {}), ...(mark?.hidden ? { hidden: true } : {}) };
}

// guides with quiz_questions and flashcards marked as the app sends them. Throws when the backend
// can't say, so a tool answers "unavailable" rather than asking a question the app would never ask.
export async function withShownQuizzes(ctx, guides) {
  const list = Array.isArray(guides) ? guides : [];
  const sets = textsOf(list);
  const requests = packed(sets);
  if (!requests.length) return list;
  const quizMarks = sets.map(set => new Array(set.quiz.length));
  const cardMarks = sets.map(() => new Map());
  const reached = new Set();
  for (const request of requests.slice(0, MAX_REQUESTS)) {
    const body = {
      quizzes: request.parts.map(part => part.quiz.map(({ text, answered }) => ({ question: text, answered }))),
      cards: request.parts.map(part => part.cards.map(({ text }) => text)),
    };
    const response = await ctx.fetchBackend('/mcp/question-wording', { method: 'POST', body });
    const marks = response?.ok ? await response.json() : null;
    if (!Array.isArray(marks?.quizzes) || marks.quizzes.length !== request.parts.length) throw new Error('question wording unavailable');
    request.parts.forEach((part, at) => {
      part.quiz.forEach((item, n) => { quizMarks[part.at][item.position] = { mark: marks.quizzes[at]?.[n] || {}, cut: item.cut }; });
      part.cards.forEach((item, n) => { cardMarks[part.at].set(item.index, { mark: marks.cards?.[at]?.[n] || {}, cut: item.cut }); });
      reached.add(part.at);
    });
  }
  // A set split across requests is reached only when every part of it was.
  requests.slice(MAX_REQUESTS).forEach(request => request.parts.forEach(part => reached.delete(part.at)));
  return list.map((guide, at) => {
    const set = sets[at];
    if (!set.quiz.length && !set.cards.length) return guide;
    if (!reached.has(at)) return { ...guide, wording: 'unknown' };
    const out = { ...guide };
    if (Array.isArray(guide.quiz_questions)) {
      out.quiz_questions = guide.quiz_questions.map((question, index) => marked(question, quizMarks[at][index]?.mark, quizMarks[at][index]?.cut));
    }
    const byText = new Map();
    (out.quiz_questions || []).forEach(question => {
      const key = String(question?.question ?? '');
      if (!byText.has(key)) byText.set(key, question);
    });
    if (Array.isArray(guide.flashcards)) {
      out.flashcards = guide.flashcards.map((card, index) => {
        const own = cardMarks[at].get(index);
        if (own) return marked(card, own.mark, own.cut);
        const question = byText.get(String(card?.front ?? ''));
        return marked(card, question ? { shown: question.shown, hidden: question.hidden } : {}, false);
      });
      // As the backend's shown_cards: a deck is never shown with every card hidden.
      const deck = out.flashcards.filter(card => card && typeof card === 'object');
      if (deck.length && deck.every(card => card.hidden)) out.flashcards = out.flashcards.map(card => marked(card, { shown: card?.shown }, false));
    }
    return out;
  });
}
