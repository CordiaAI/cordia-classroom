// Guided tours shown once during setup. Each step outlines a real element on the page.
export const SMARTNOTES_TOUR = [
  {
    target: '.sn-paper-wrap',
    side: 'right',
    title: 'Your notes editor',
    text: 'This is where you take notes during lecture. Headings, bullets, and bold are kept, and Turn into Study Guide makes a guide from them anytime.',
  },
  {
    target: '.sn-viewer-wrap',
    side: 'left',
    title: 'Class material',
    text: 'This is where you can view the slideshows/files of the lecture to follow along with ease! Click Open File to add one.',
  },
  {
    target: '.sn-diagram-wrap',
    side: 'left',
    title: 'Visual diagrams',
    text: 'Click Visualize, highlight the text you want to see as a diagram, then click the ✓ in the top right of the notes editor.',
  },
];

// Runs on the real Practice workspace, with or without a study guide chosen.
export const PRACTICE_TOUR = [
  {
    target: '.practice-guide-picker',
    side: 'left',
    title: 'Choose a study guide',
    text: 'Pick the study guide you want to practice. No guides yet? Choose Create guide or upload file.',
  },
  {
    target: '.practice-source-actions .btn',
    side: 'left',
    title: 'Generate problems',
    text: 'Click Generate 10 problems to get new problems built from your study guide. Regenerate anytime for a fresh set.',
  },
  {
    target: '.practice-board',
    side: 'right',
    title: 'Work it out',
    text: 'This is your workspace: draw, type, drop in symbols and exponents, or click Tidy handwriting to turn it into clean text.',
  },
  {
    target: '.practice-answer',
    side: 'right',
    title: 'Check your answer',
    text: 'Type your final answer here and click Check answer to see if you got it right.',
  },
  {
    target: '.practice-source-panel',
    side: 'left',
    title: 'Reveal only when stuck',
    text: 'Your study guide sits here, blurred. Try the problem first, then double-click a section to reveal it.',
  },
  {
    target: ['.tutor-drawer-toggle', '.tutor-dock-toggle'],
    side: 'right',
    title: 'Wrong answers get explained',
    text: 'When an answer is wrong, Cordia sends a prompt to your Tutor, which explains what went wrong and how to fix it.',
  },
];
