// What each connected app lets a student do, in the words of the screens they'll use. One list,
// shown in three places: "Try it" in the app's sheet (Settings › Connectors), the Dashboard's
// setup card, and Learn Cordia's "Your apps" group. Each try is { text, href?, label? }: with an
// href it's a link to the place it happens; without, it happens right there in the sheet.
export const TRY = {
  canvas: [
    { text: 'See every deadline for the week in one place.', href: '/canvas?tab=calendar', label: 'Open calendar' },
    { text: 'Plan your week: pick what to work on and Cordia finds the time.', href: '/week', label: 'Plan your week' },
    { text: 'On a class, open Grades to see what each assignment needs to keep or raise your grade.', href: '/library', label: 'Open Library' },
  ],
  gcal: [
    { text: 'Plan your week: study time lands on a separate "Cordia" calendar, around what you already have.', href: '/week', label: 'Plan your week' },
    { text: 'On the Dashboard, tap the steps button by any deadline to break it down and schedule each step.', href: '/dashboard', label: 'Open Dashboard' },
  ],
  apple_calendar: [
    { text: 'Your deadlines show up in Calendar on your iPhone, iPad and Mac, and stay current on their own.' },
  ],
  gtasks: [
    { text: 'Each deadline becomes a to-do in a "Cordia" list, with its steps as subtasks. Check one off on your phone and it\'s done here too.' },
    { text: 'Break a big assignment into steps from the Dashboard; they show up as subtasks.', href: '/dashboard', label: 'Open Dashboard' },
  ],
  gdrive: [
    { text: 'Link a class folder below: new slides and readings come into that class in Library on their own.' },
    { text: 'Import one file with the Import button, then pick the class it belongs to.' },
    { text: 'Save a copy of any guide to Drive: open the guide, then ⋯ › Export › Save a copy to Drive.', href: '/library', label: 'Open Library' },
  ],
  gdocs: [
    { text: 'Export a guide as a formatted Doc: open the guide, then ⋯ › Export › Google Docs.', href: '/library', label: 'Open Library' },
    { text: 'Writing an essay? On the Dashboard, tap the steps button by the assignment, then Link a Google Doc. The Tutor checks your draft against the rubric, and Cordia nudges you if it stalls near the deadline.', href: '/dashboard', label: 'Open Dashboard' },
    { text: 'Bring a Doc into Library with the Import button.' },
  ],
  notion: [
    { text: 'Set up your course database below: every assignment as a row with its course, due date and status. Mark one Done in Notion and it\'s done here too.' },
    { text: 'Export a guide to self-quiz in Notion: open the guide, then ⋯ › Export › Notion. Each question is a toggle hiding its answer.', href: '/library', label: 'Open Library' },
    { text: 'Bring a Notion page into Library with the Import button.' },
  ],
  gmail: [
    { text: 'Switch on Watch for date changes: when a professor emails that an exam moved, it shows on your Dashboard to confirm in one tap.' },
    { text: 'Text Cordia Assistant "any emails I need to answer?"', href: '/assistant', label: 'Open Assistant' },
  ],
  outlook: [
    { text: 'Switch on Watch for date changes: when a professor emails that an exam moved, it shows on your Dashboard to confirm in one tap.' },
    { text: 'Text Cordia Assistant "any emails I need to answer?"', href: '/assistant', label: 'Open Assistant' },
  ],
  gsheets: [
    { text: 'Export your grades and daily study time below, and switch on Keep it updated daily.' },
    { text: 'Text Cordia Assistant "log 2 hours of bio in my study sheet".', href: '/assistant', label: 'Open Assistant' },
  ],
  slack: [
    { text: 'Watch your class channels below: a post saying an exam moved shows on your Dashboard to confirm in one tap.' },
    { text: 'Post a study session below so your group can join; Cordia reminds the channel before it starts.' },
    { text: 'Text Cordia Assistant "what did I miss in my study group?"', href: '/assistant', label: 'Open Assistant' },
  ],
  ynab: [{ text: 'Text Cordia Assistant "how much is left for groceries?"', href: '/assistant', label: 'Open Assistant' }],
  dropbox: [
    { text: 'Link a class folder below: new slides and readings come into that class in Library on their own.' },
    { text: 'Import one file with the Import button, then pick the class it belongs to.' },
  ],
  github: [
    { text: 'Coding an assignment? On the Dashboard, tap the steps button by it, then Link a GitHub repo. You\'ll see your commits against the due date.', href: '/dashboard', label: 'Open Dashboard' },
    { text: 'Then tap Ask Tutor about my code: it reads your repo with the instructions and rubric. If the repo goes quiet near the deadline, Cordia nudges you.' },
  ],
};

// The Dashboard setup card, in the order that pays off soonest. `any` means one of these is enough.
export const SETUP = [
  { id: 'canvas', name: 'Canvas', gets: 'Your classes, deadlines and grades, kept current.' },
  { id: 'gcal', name: 'Google Calendar', gets: 'Study time planned around your week.' },
  { id: 'gtasks', name: 'Google Tasks', gets: 'Every deadline as a to-do on your phone.' },
  { id: 'gdrive', name: 'Google Drive', gets: 'Class folders that fill your Library on their own.' },
  { id: 'gmail', any: ['gmail', 'outlook'], name: 'Gmail or Outlook', gets: 'Moved exams and extensions caught from your email.' },
  { id: 'gdocs', any: ['gdocs', 'notion'], name: 'Google Docs or Notion', gets: 'Guides exported where you work, and feedback on drafts.' },
];

// Where "Connect" goes: the app's sheet in Settings › Connectors.
export const connectHref = id => `/settings?section=connectors&open=${encodeURIComponent(id)}`;
