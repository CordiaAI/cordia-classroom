// /install-extension: the Chrome extension. The URL predates the use-case pages and AI answers
// already cite it, so it keeps its slug. Copy only; the layout is components/UseCasePage.js. Every
// statement comes from extension/ (the PR that rebuilt this page lists the file and line behind each
// one); change the code first, then this copy. Section 5 of the privacy policy says the same things.
import { freeAllowance } from '../brand.mjs';
import { EXTENSION_STORE_URL } from '../extension.js';

export default {
  slug: 'install-extension',
  updated: '2026-11-08',
  crumb: 'Chrome extension',
  topic: 'Chrome Extension for Study Guides',
  description: 'Add the Cordia Classroom Chrome extension and turn the course page, PDF or Google Doc you have open into a study guide with questions and flashcards.',
  footerLabel: 'The Chrome extension',
  h1: 'Make study guides from any course page with the Cordia Classroom Chrome extension',
  lede: [
    'The Cordia Classroom Chrome extension turns the course page, PDF or Google Doc you have open into a study guide with notes, questions and answers, and flashcards, saved to your Cordia account.',
    'It opens in Chrome\'s side panel, where you can also ask the Tutor about the page.',
  ],
  steps: [
    'Open the Chrome Web Store listing and choose Add to Chrome.',
    'Pin it: choose Chrome\'s puzzle-piece Extensions icon, then the pin next to Cordia Classroom.',
    'Sign in on the Cordia Classroom website. The extension connects to that session by itself.',
    'Open a course page, PDF or Google Doc, open the side panel and choose Make study guide. The guide is saved to your account, and Open guide shows it in a new tab.',
  ],
  sections: [
    {
      question: 'What does the extension read?',
      answer: 'Text you have selected comes first; otherwise a document embedded in the page, such as a PDF; otherwise the page\'s own text; and if the page has little text but links to a document, that document.',
      bullets: [
        'Google Docs, Slides and Sheets are read as a PDF export, using your own Google sign-in in Chrome.',
        'Embedded and linked documents can be PDF, PowerPoint (.pptx), Word (.docx), text, CSV or image files, up to 50 MB.',
        'The extension also takes a picture of the visible tab. It is sent only when the page has under 400 characters of text, or when the page can\'t be read.',
        'It works on web pages: addresses that start with http or https.',
      ],
    },
    {
      question: 'How do I open it?',
      answer: 'Choose the Cordia Classroom icon in Chrome\'s toolbar, or press Ctrl+Shift+Y (Command+Shift+Y on a Mac), and it opens in the side panel.',
      bullets: [
        'Right-click text you have selected and choose Make study guide from selection to make a guide from just that text.',
      ],
    },
    {
      question: 'When does it read the page, and what permissions does it ask for?',
      answer: 'It reads page content only when you click Make study guide, choose Make study guide from selection, or ask the Tutor a question before you have made a guide. The Cordia Classroom website can also ask it to read a Quizlet set or YouTube transcript you add there.',
      paragraphs: [
        'While the side panel is open it shows the title of the tab you are on. Its only automatic script runs on the Cordia Classroom website, to pick up your sign-in. It sends what it reads only to the Cordia Classroom API and doesn\'t collect your browsing history.',
      ],
      bullets: [
        'Side panel (sidePanel): to open next to the page.',
        'Right-click menu (contextMenus): for Make study guide from selection.',
        'Scripting, active tab and access to all sites (scripting, activeTab, <all_urls>): to read the page you ask it to read, the documents it embeds or links to, and the picture of the visible tab, on whatever site your course is on.',
        'Storage (storage): to keep you signed in between sessions.',
      ],
      link: { href: '/privacy', label: 'Read the privacy policy' },
    },
    {
      question: 'Does it work on Canvas, Blackboard, Moodle and D2L?',
      answer: 'Yes. It works on any course page that opens in Chrome, and it knows where the main content sits on Canvas, Blackboard, Moodle and D2L Brightspace pages.',
      paragraphs: [
        'On Canvas it also leaves out the page header and navigation, and turns file links into direct downloads. Files your school shows only after you sign in are downloaded with your own browser session; your cookies aren\'t sent to Cordia.',
      ],
      link: [
        { href: '/canvas-study-tool', label: 'Connect Canvas to Cordia, too' },
        { href: '/best-ai-study-platforms-canvas-integration', label: 'See which AI study tools work with Canvas' },
      ],
    },
    {
      question: 'How do I sign in?',
      answer: 'Sign in on the Cordia Classroom website and the extension connects to that session by itself, so there is no second password.',
      paragraphs: [
        'When you are signed out, the side panel shows Connect, which opens the website. Signing out of the website signs the extension out too.',
      ],
    },
  ],
  scenarios: [
    'A student whose professor posts readings as Canvas pages opens this week\'s page and makes a guide from it in the side panel.',
    'A student with lecture notes in a shared Google Doc makes a guide from the open document without downloading it.',
    'A student selects the one section of a long article that will be on the quiz and chooses Make study guide from selection.',
  ],
  faq: [
    {
      question: 'Is the extension free?',
      answer: `Yes, it is free to add. Guides made with it count toward the same monthly study guides as the website: ${freeAllowance('guide')} a month on the Free plan, and more on Pro and Academic Weapon.`,
    },
    {
      question: 'Does it save the guide by itself?',
      answer: 'Yes. As soon as the guide is ready it is saved to your Cordia account, with its flashcards and notes. Open guide opens it in a new tab; the extension never changes the tab you are reading.',
    },
    {
      question: 'Can I ask the Tutor about the page?',
      answer: 'Yes. The side panel has a Tutor: ask about the page for an explanation, an example or a quick check. Tutor replies count toward their own monthly allowance.',
    },
    {
      question: 'Does it read slides?',
      answer: 'Slides that are an embedded or linked file, and Google Slides, are read as a document. Other slides on a page are read from the page\'s text, or from the picture of the visible tab when there is little text.',
    },
    {
      question: 'Which browser do I need?',
      answer: 'Google Chrome, version 114 or later.',
    },
  ],
  cta: { href: EXTENSION_STORE_URL, label: 'Add to Chrome, free', event: 'extension-opened' },
};
