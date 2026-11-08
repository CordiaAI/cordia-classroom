// /ai-flashcard-maker: flashcards from a student's own study guide. Copy only; the layout is
// components/UseCasePage.js. Every statement comes from the code; the PR that adds this page lists
// the file and line behind each one. Change the code first, then this copy.
import { freeAllowance, listText } from '../brand.mjs';
import { INTERVALS } from '../spacedReview.mjs';
import { FADE_DAYS, LEVELS } from '../learnEngine.mjs';

export default {
  slug: 'ai-flashcard-maker',
  updated: '2026-11-08',
  crumb: 'AI flashcard maker',
  topic: 'AI Flashcard Maker from Your Notes',
  description: 'Cordia Classroom makes flashcards from your own slides, PDFs and notes, brings them back on a spaced schedule, and imports your Quizlet sets.',
  footerLabel: 'Flashcards from your material',
  h1: 'Make flashcards from your own course material with Cordia Classroom',
  lede: [
    'Cordia Classroom is an AI flashcard maker for your own course material: every study guide it writes comes with a flashcard for each of its questions.',
    'You review the cards on a spaced schedule and learn them in Learn, where answering from memory is what masters an idea.',
  ],
  steps: [
    'Make a study guide from your slides, PDFs or notes.',
    'Cordia turns each question and answer in the guide into a flashcard.',
    'Open Flashcards, flip each card, and choose Got it or Again, or swipe right or left.',
    'Keep going with Learn or Study now; cards come back on a spaced schedule.',
  ],
  screenshots: [
    { src: '/use-cases/flashcards.webp', width: 1600, height: 575, alt: 'A flashcard from the guide How Memory Works showing the term Retrieval practice, with Still learning and Know counts and a Flip button', caption: 'Flashcards made from the guide.' },
    { src: '/use-cases/learn.webp', width: 1600, height: 775, alt: 'Learn for the guide, showing 0% ready, a test date field and the ways to learn: Choice, Type it, Fill the blank and Flashcards', caption: 'Learn: pick how you want to be asked.' },
  ],
  screenshotNote: "Screenshots show Cordia's built-in sample guide, How Memory Works.",
  sections: [
    {
      question: 'How are the flashcards made?',
      answer: 'From the study guide: each question and answer becomes one card, with exact duplicates and empty answers left out.',
      paragraphs: [
        'There is no fixed number of cards: a longer guide has more questions, so it has more cards. Cards are made with the guide whether you start in Cordia, in the Chrome extension or from a recorded lecture, and a guide that starts as notes gets its cards the first time you open them.',
      ],
    },
    {
      question: 'How does spaced review work in Cordia?',
      answer: `Cards come back after ${listText(INTERVALS.map(String))} days, a step further along that schedule each time you finish a round with them.`,
      bullets: [
        'Flip (or Space) shows the answer.',
        'Got it (or 2, or a swipe right) counts the card as known for this round.',
        'Again (or 1, or a swipe left) sends the card to the back of the round, so you see it again before the round ends.',
        'Library shows how many cards are due, and Study now on a guide mixes due cards with Learn ideas, up to 30 cards a round.',
      ],
    },
    {
      question: 'Can I import a Quizlet set or write my own cards?',
      answer: 'Yes. Import from Quizlet reads a set from its link with the Chrome extension, or from the text Quizlet exports, and Write cards lets you type your own.',
      bullets: [
        'Links work for public sets and sets you can open while signed in to Quizlet. Use the set\'s own link, not a Learn, Match or Test link.',
        'Without the extension: on Quizlet choose ⋯, then Export, then Copy text, and paste it into Cordia.',
        'A link brings in up to 1,000 cards, as text: images don\'t come over.',
        'Imported cards open in the editor so you can check them before saving.',
        'Write cards gives each card a Term and a Definition, and Add card adds another. Cards you write or import don\'t use your monthly study guides.',
      ],
    },
    {
      question: 'Can I add images to cards?',
      answer: 'Yes. Each side of a card can have a photo, and on a phone you can take it with the camera.',
      paragraphs: [
        'Photos are resized in your browser to at most 1,600 pixels on a side, and must be a JPEG, PNG, WebP or GIF under 3 MB. GIFs keep moving.',
      ],
    },
    {
      question: 'What is Learn mode, and why does only recall master an idea?',
      answer: `Learn moves each idea through ${listText(LEVELS)}: picking from choices takes an idea to Familiar, and answering from memory masters it.`,
      paragraphs: [
        'With Learn\'s default ways of asking (Choice, Fill the blank and Type it), new ideas start as choices and familiar ones are asked from memory, because recalling an answer sticks better for a test than recognising it. A right answer you marked as a guess doesn\'t move the idea up, and a miss drops it back to Learning.',
        `Mastered ideas come back after ${FADE_DAYS} days so they stay fresh, and if you add a test date, Learn paces you to master everything the day before. If you turn on only Choice, a right pick on a familiar idea masters it, and Learn tells you so.`,
      ],
    },
  ],
  scenarios: [
    'A biology student makes a guide from a lecture PDF and reviews its flashcards on the bus with swipes.',
    'A student switching from Quizlet brings in last term\'s sets from their links with the Chrome extension.',
    'An art history student adds a photo of each painting to the front of its card.',
  ],
  faq: [
    {
      question: 'Are the flashcards free?',
      answer: `Yes. Studying, writing and importing cards and adding photos have no plan limit. Making a study guide with AI, which makes its cards, uses one of your monthly study guides: ${freeAllowance('guide')} a month on Free.`,
    },
    {
      question: 'How many cards does a guide make?',
      answer: 'One for each question in the guide, so there is no fixed number.',
    },
    {
      question: 'Can I edit the cards?',
      answer: 'Yes. Choose Edit in the guide\'s menu to change its questions and flashcards and to add photos.',
    },
    {
      question: 'Can I study only the cards that are due?',
      answer: 'Yes. Study now on a guide brings the due cards first, up to 30 cards a round; with nothing due, it runs a full round of the guide\'s cards. Flashcards on its own plays the whole deck.',
    },
    {
      question: 'Do Quizlet images come over?',
      answer: 'No. An import brings the text of each term and definition.',
    },
  ],
};
