// The MCP prompts (Phase 4): short starting messages a student can pick in their AI app. They only
// say what to do; the tools do the work (and their descriptions carry the rules).
import * as z from 'zod';

const id = z.uuid();
const user = text => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

// One question at a time, confidence before the answer, every answer logged: the same rules the
// server instructions give.
const QUIZ_RULES = 'Ask one question at a time and wait for my answer. Before you reveal anything, ask how sure I was (sure, think so or guess). Then tell me whether I was right, judging by meaning rather than exact wording, and show the answer.';

export const PROMPTS = [
  {
    name: 'study_now',
    title: 'Study now',
    description: 'Today\'s Cordia review: the cards due now, in the order Study now uses, with every answer logged.',
    args: { course_id: id.optional().describe('Only this course.') },
    text: ({ course_id }) => [
      `Run my Cordia Study now session. Call get_due_cards${course_id ? ` with course_id ${course_id}` : ''} and go through the cards in the order given, showing only the front.`,
      QUIZ_RULES,
      'Log each answer with record_answer (the card\'s card_id, a new idempotency_key each time).',
      'When the cards run out or I stop, tell me how many I got right and how many are still due.',
    ].join(' '),
  },
  {
    name: 'quiz_me',
    title: 'Quiz me',
    description: 'Ten questions from one Cordia study set, mixing flashcards and quiz questions, with every answer logged.',
    args: { study_set_id: id.describe('The study set to quiz on (from list_study_sets or search_my_materials).') },
    text: ({ study_set_id }) => [
      `Quiz me on my Cordia study set ${study_set_id}. Call get_study_set with include flashcards and quiz, then ask me 10 questions, mixing flashcards and quiz questions.`,
      QUIZ_RULES,
      'Log each answer with record_answer: item_type flashcard with the card_id for flashcards, quiz_question with the question_id for quiz questions.',
      'At the end, give me my score and the ideas to review.',
    ].join(' '),
  },
  {
    name: 'review_lecture',
    title: 'Review a lecture',
    description: 'Walks through a recorded lecture\'s "Watch for" points with their quotes and timestamps, then quizzes on them.',
    args: { lecture_id: id.describe('The lecture to review (from list_lectures or search_my_materials).') },
    text: ({ lecture_id }) => [
      `Help me review my Cordia lecture ${lecture_id}. Call get_lecture and walk me through its "Watch for" points one at a time, each with the professor's quote and timestamp.`,
      `Then quiz me on them. ${QUIZ_RULES}`,
      'These questions aren\'t Cordia cards, so don\'t log them with record_answer. At the end, offer to save the ones I missed as a note with save_note.',
    ].join(' '),
  },
];

export function registerPrompts(server) {
  for (const prompt of PROMPTS) {
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: z.object(prompt.args) }, args => user(prompt.text(args || {})));
  }
}
