// Every page has its own tab title ("Library — CordiaClassroom"), so tabs, history, bookmarks and
// screen readers can tell pages apart. Pages about one thing (a guide, a lecture, a class) set
// their own title with pageTitle(name).
export const BRAND = 'CordiaClassroom';

export const pageTitle = name => (name ? `${name} — ${BRAND}` : BRAND);

const TITLES = {
  '/': 'Study smarter', '/login': 'Sign in', '/signup': 'Sign up', '/dashboard': 'Dashboard', '/library': 'Library',
  '/canvas': 'Canvas', '/calendar': 'Calendar', '/week': 'Your week', '/progress': 'Progress', '/assistant': 'Assistant',
  '/tutor': 'Tutor', '/settings': 'Settings', '/billing': 'Billing', '/pricing': 'Pricing', '/create': 'Write cards',
  '/flashcards': 'Flashcards', '/flashcards/study': 'Flashcards', '/practice': 'Practice', '/session': 'Study session',
  '/smartnotes': 'Notes', '/instructors': 'Instructors', '/install-extension': 'Get the extension', '/mission': 'Features',
  '/privacy': 'Privacy Policy', '/terms': 'Terms of Service', '/honor-code': 'Honor Code', '/copyright': 'Copyright',
  '/feedback-review': 'Feedback', '/admin': 'Admin', '/auth/callback': 'Signing in', '/reset-password': 'Reset password',
  '/guide/[id]': 'Study guide', '/lecture/[id]': 'Lecture', '/folder/[id]': 'Class', '/class/[id]': 'Class',
  '/quiz/[guideId]': 'Quiz', '/practice/[guideId]': 'Practice', '/nclex/[guideId]': 'NCLEX practice',
  '/games/[guideId]': 'Games', '/play/[guideId]': 'Blocks', '/404': 'Page not found',
};

export const routeTitle = pathname => pageTitle(TITLES[pathname]);
