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

export const PRACTICE_TOUR = [
  {
    target: '.practice-hero',
    side: 'right',
    title: 'Practice',
    text: 'Practice is where you turn a study guide into problems you actually work through, not just reread.',
  },
  {
    target: ['.practice-mode-list', '.practice-empty'],
    side: 'left',
    title: 'Generate problems',
    text: 'Pick a study guide, open Work it out, then click Generate problems to get new problems built from your material.',
  },
  {
    target: '.practice-loop',
    side: 'right',
    title: 'Reveal only when stuck',
    text: 'In the workspace your study guide sits blurred beside the problems. Try first, then double-click a section to reveal it.',
  },
  {
    target: ['.tutor-drawer-toggle', '.tutor-dock-toggle', '.practice-loop'],
    side: 'left',
    title: 'Wrong answers get explained',
    text: 'When an answer is wrong, Cordia sends a prompt to your Tutor, which explains what went wrong and how to fix it.',
  },
];
