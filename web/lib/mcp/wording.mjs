// A saved quiz question is never rewritten: progress, misses and the answer log are keyed by its
// text. The app shows one that points at the source in other words ("According to Slide 5, what is
// X?" asks "What is X?") and never asks one about the source itself ("Which artists are listed for
// Chapter 1?"). The rules are the backend's (services/text_processing.shown_questions, the same the
// app's routes use); this asks it how each question of the study sets read here is shown and marks
// them the same way: `shown` (the wording to show) or `hidden`, every question in its place.
import { conceptAnswer } from '../retainEngine.mjs';

const MAX_SETS = 100;
const MAX_QUESTIONS = 200;
const MAX_CHARS = 20000;

// guides with quiz_questions marked as the app sends them. Throws when the backend can't say, so a
// tool answers "unavailable" rather than asking a question the app would never ask.
export async function withShownQuizzes(ctx, guides) {
  const list = Array.isArray(guides) ? guides : [];
  const asked = list.filter(guide => Array.isArray(guide?.quiz_questions) && guide.quiz_questions.length).slice(0, MAX_SETS);
  if (!asked.length) return list;
  const quizzes = asked.map(guide => guide.quiz_questions.slice(0, MAX_QUESTIONS)
    .map(question => ({ question: String(question?.question ?? '').slice(0, MAX_CHARS), answered: Boolean(conceptAnswer(question)) })));
  const response = await ctx.fetchBackend('/mcp/question-wording', { method: 'POST', body: { quizzes } });
  const marks = response?.ok ? (await response.json())?.quizzes : null;
  if (!Array.isArray(marks) || marks.length !== asked.length) throw new Error('question wording unavailable');
  const marked = new Map(asked.map((guide, at) => [guide, guide.quiz_questions.map((question, index) => {
    if (!question || typeof question !== 'object') return question;
    const { shown, hidden, ...saved } = question;
    const mark = marks[at]?.[index] || {};
    return { ...saved, ...(typeof mark.shown === 'string' ? { shown: mark.shown } : {}), ...(mark.hidden ? { hidden: true } : {}) };
  })]));
  return list.map(guide => (marked.has(guide) ? { ...guide, quiz_questions: marked.get(guide) } : guide));
}
