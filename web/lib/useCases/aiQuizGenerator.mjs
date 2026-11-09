// /ai-quiz-generator: quizzes from a student's own study guide. Copy only; the layout is
// components/UseCasePage.js. Quizzes live in Learn's "Test yourself" (web/pages/learn/[guideId].js),
// not in a tab of their own. Every statement comes from the code; the PR that adds this page lists
// the file and line behind each one. Change the code first, then this copy.
import { freeAllowance } from '../brand.mjs';
import { MAX_QUESTIONS, MAX_RECOMMENDED, MIN_RECOMMENDED } from '../quizLength.mjs';
import { CLEAR_AFTER, SPACING } from '../retainEngine.mjs';
// CHECK_COUNT in lib/checkYourself.js (5); that file needs the browser, so tests/use-case-pages
// checks the number instead of importing it here.
const CHECK_COUNT = 5;

const words = { 2: 'two', 3: 'three', 5: 'five' };

export default {
  slug: 'ai-quiz-generator',
  updated: '2026-11-08',
  crumb: 'AI quiz generator',
  topic: 'AI Quiz Generator from Your Notes',
  description: 'Make practice quizzes, timed tests and matching games from your own course notes with Cordia Classroom. Missed questions come back until you get them.',
  footerLabel: 'Practice quizzes from your notes',
  h1: 'Make practice quizzes from your course notes with Cordia Classroom',
  lede: [
    'Cordia Classroom is an AI quiz generator for your own course material: it turns the questions and answers in your study guide into practice quizzes, timed tests and a matching game.',
    'Questions you miss come back later in the quiz, so a quiz teaches as well as tests.',
  ],
  steps: [
    'Make a study guide from your notes, slides or PDFs.',
    'Open Learn on the guide and choose Quiz under Test yourself.',
    'Pick the question types and how many questions, or use the recommended number.',
    `Answer each question; one you miss comes back ${words[SPACING]} questions later until you get it right ${words[CLEAR_AFTER]} more times.`,
  ],
  screenshots: [
    { src: '/use-cases/test-yourself.webp', width: 1520, height: 292, alt: 'The Test yourself section of Learn with three choices: Quiz (every idea, misses repeat), Timed test (a mock exam on the clock) and Match (pair them up in 60 seconds)', caption: 'Quizzes live in Learn, under Test yourself.' },
    { src: '/use-cases/quiz-setup.webp', width: 1600, height: 875, alt: 'Quiz setup for the guide How Memory Works: question types Choice, Written, Fill in and Pairs, a question count with the recommended number, and Show if I\'m right set to After each question', caption: 'Pick the question types and how many questions.' },
  ],
  screenshotNote: "Screenshots show Cordia's built-in sample guide, How Memory Works, on a Free account (the locks mark paid types).",
  sections: [
    {
      question: 'How do I make a quiz from my notes?',
      answer: 'Make a study guide from your notes, then open Learn on it and choose Quiz under Test yourself. The quiz asks the guide\'s own questions, and AI writes the wrong answer choices.',
      paragraphs: [
        `A short guide is quizzed on everything; a longer one starts at about half its questions, ${MIN_RECOMMENDED} to ${MAX_RECOMMENDED}, and you can choose up to ${MAX_QUESTIONS}. Questions are picked at random and shuffled. Each wrong choice must be clearly false for its question, never a rewording of the right answer.`,
      ],
      link: { href: '/best-ai-study-platforms-canvas-integration', label: 'AI study platforms compared' },
    },
    {
      question: 'What question types are there?',
      answer: `Choice and Written are free; Fill in and Pairs (matching) are paid, and the Free plan includes ${freeAllowance('retain_types')} quiz with them each month.`,
      bullets: [
        'Choice: pick the right answer from four.',
        'Written: answer in your own words, and AI checks it against the guide\'s answer.',
        'Fill in: type a short answer. Case, small typos, plurals and words like "the" are fine; numbers must be exact.',
        'Pairs: match terms to their answers, a few at a time.',
        'Each question gets the type that suits its answer: a term can be Fill in or Pairs, a one-sentence answer is Choice, and a longer explanation is Written.',
        'Timed test: a mock exam on the clock, with 30 seconds, 1 minute or 2 minutes per question and no answers until you hand it in.',
        'Match: pair each question with its answer before 60 seconds run out.',
      ],
    },
    {
      question: 'What happens when I miss a question?',
      answer: `In a quiz, a missed question comes back ${words[SPACING]} questions later and has to be answered right ${words[CLEAR_AFTER]} more times before it clears. Your score counts first tries only.`,
      paragraphs: [
        'Getting a repeat wrong starts its count again, and after 8 repeats a question stops coming back so you are never stuck. Repeats change format, for example between fill in the blank and multiple choice.',
        'After a miss, Ask why shows why the right answer is right and why yours isn\'t, and Help me remember gives you a memory hook. In Learn, a miss drops the idea back to Learning and asks it once more at the end of the round.',
      ],
    },
    {
      question: 'How is this different from rereading?',
      answer: 'Answering a question makes you pull the idea out of memory, and that retrieval is what makes it last.',
      paragraphs: [
        'In a 2006 study in Psychological Science, Henry Roediger and Jeffrey Karpicke had students either restudy prose passages or take recall tests on them. On a test five minutes later the restudy group recalled more, but on tests two days and one week later the students who had been tested retained substantially more, even though restudying made students more confident they would remember.',
      ],
      link: { href: 'https://doi.org/10.1111/j.1467-9280.2006.01693.x', label: 'Roediger and Karpicke (2006), "Test-Enhanced Learning", Psychological Science 17(3), 249–255' },
    },
    {
      question: 'What is "Check yourself" on a new guide?',
      answer: `When a new guide is ready, it opens on Check yourself: ${words[CHECK_COUNT]} quick multiple-choice questions, spread across the whole guide, before you read it.`,
      paragraphs: [
        'You see whether each answer is right as you go, and missed questions repeat like in a quiz. Skip to reading takes you straight to the guide.',
      ],
    },
  ],
  scenarios: [
    'A psychology student takes a 15-question quiz on each chapter guide the week before a midterm and retries the misses until they clear.',
    'A student with a timed final sets a timed test at 1 minute a question to practice working under the clock.',
    'A Spanish student uses Pairs to drill vocabulary from a guide made from class handouts.',
  ],
  faq: [
    {
      question: 'Are written answers graded by AI, and how?',
      answer: `Yes. Cordia\'s faster AI model marks each written answer against your guide\'s answer, judging meaning rather than wording, and says Right, Partly right or Not quite; partly right counts as half. Each check uses one AI reading action (${freeAllowance('light')} a month on Free). Short typed answers are checked without AI.`,
    },
    {
      question: 'Can I retake a quiz?',
      answer: 'Yes, as often as you like: Restart takes you back to the quiz setup. A quiz that uses Fill in or Pairs counts as one paid quiz each time. Your last 10 scores are listed under Past.',
    },
    {
      question: 'Does it work for math or problem-solving?',
      answer: `A quiz asks the questions in your guide, including how to apply a method from a worked example. For practice problems, use Practice on the guide: it makes ten problems, recomputes numeric answers, and checks your work (${freeAllowance('practice')} free practice set a month on Free).`,
    },
    {
      question: 'Who writes the quiz questions?',
      answer: 'The questions come from your study guide, which is written only from your material. AI writes the three wrong choices for each multiple-choice question.',
    },
    {
      question: 'Can I see the answers right away?',
      answer: 'You choose: after each question, or when you submit. A quiz starts with after each question, and a timed test with when you submit, like a real exam.',
    },
  ],
};
