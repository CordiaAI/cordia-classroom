// The MCP prompts (Phase 4): short starting messages a student can pick in their AI app. They only
// say what to do; the tools do the work (and their descriptions carry the rules).
import * as z from 'zod';

const user = text => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

// Prompt arguments are typed by the student in their AI app, so each one takes an id or a name and
// may be left empty. The text then says which tool turns a name into an id.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const choice = description => z.string().trim().max(200).optional().describe(description);
const quoted = value => `"${String(value).replace(/["\n]/g, ' ').trim()}"`;

// One question at a time, confidence before the answer, every answer logged: the same rules the
// server instructions give.
const QUIZ_RULES = 'Ask one question at a time and wait for my answer. Before you reveal anything, ask how sure I was (sure, think so or guess). Then tell me whether I was right, judging by meaning rather than exact wording, and show the answer.';

function courseStep(course) {
  if (!course) return 'Call get_due_cards';
  if (UUID.test(course)) return `Call get_due_cards with course_id ${course}`;
  return `Find my course named ${quoted(course)} in list_study_sets (each set shows its course), then call get_due_cards with that course_id`;
}

function studySetStep(studySet) {
  if (!studySet) return 'Pick my weakest study set from get_progress weak_topics (ask me if there are none) and say which. Then call get_study_set on it';
  if (UUID.test(studySet)) return `Call get_study_set on my Cordia study set ${studySet}`;
  return `Find my study set titled ${quoted(studySet)} with list_study_sets (query); ask me if several match. Then call get_study_set on it`;
}

function lectureStep(lecture) {
  if (!lecture) return 'Call list_lectures and use my most recent lecture (tell me which one). Then call get_lecture on it';
  if (UUID.test(lecture)) return `Call get_lecture on my Cordia lecture ${lecture}`;
  return `Find my lecture titled ${quoted(lecture)} with list_lectures; ask me if several match. Then call get_lecture on it`;
}

export const PROMPTS = [
  {
    name: 'study_now',
    title: 'Study now',
    description: 'Today\'s Cordia review: the cards due now, in the order Study now uses, with every answer logged.',
    args: { course: choice('A course name or id, to review only that course. Leave empty for all courses.') },
    text: ({ course }) => [
      `Run my Cordia Study now session. ${courseStep(course)}, and go through the cards in the order given, showing only the front.`,
      QUIZ_RULES,
      'Log each answer with record_answer (the card\'s card_id, a new idempotency_key each time).',
      'When the cards run out or I stop, tell me how many I got right and how many are still due.',
    ].join(' '),
  },
  {
    name: 'quiz_me',
    title: 'Quiz me',
    description: 'Ten questions from one Cordia study set, mixing flashcards and quiz questions, with every answer logged.',
    args: { study_set: choice('The study set\'s title or id. Leave empty to quiz on your weakest set.') },
    text: ({ study_set }) => [
      `Quiz me. ${studySetStep(study_set)} with include flashcards and quiz, and ask me 10 questions, mixing flashcards and quiz questions.`,
      QUIZ_RULES,
      'Log each answer with record_answer (flashcard with its card_id, quiz_question with its question_id).',
      'At the end, give me my score and the ideas to review.',
    ].join(' '),
  },
  {
    name: 'review_lecture',
    title: 'Review a lecture',
    description: 'Walks through a recorded lecture\'s "Watch for" points with their quotes and timestamps, then quizzes on them.',
    args: { lecture: choice('The lecture\'s title or id. Leave empty for your most recent lecture.') },
    text: ({ lecture }) => [
      `Help me review a Cordia lecture. ${lectureStep(lecture)}, and walk me through its "Watch for" points one at a time, each with the professor's quote and timestamp.`,
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
