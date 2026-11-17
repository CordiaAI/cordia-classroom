// The app shell (DESIGN-SPEC 3.2 and 3.4): which tools the rail shows, where each one goes, and
// which sidebar item and rail button are the current place. Pure, so the rules can be tested in
// Node (web/tests/app-shell.test.mjs); components/Sidebar.js and components/ToolRail.js render it.

// The rail, top to bottom (DESIGN-SPEC 3.4). `icon` names a lucide icon (ToolRail maps it).
export const RAIL_TOOLS = [
  { key: 'make', label: 'Make guide', icon: 'FilePlus', line: 'Turn slides, PDFs, links or a lecture into a study guide.' },
  { key: 'learn', label: 'Learn', icon: 'GraduationCap', line: 'Master every idea before the test, one round at a time.' },
  { key: 'flashcards', label: 'Flashcards', icon: 'Layers', line: 'Review cards when they’re due, so they stick.' },
  { key: 'quiz', label: 'Quiz', icon: 'ListChecks', line: 'Test yourself. Misses come back until you get them right.' },
  { key: 'practice', label: 'Practice', icon: 'PencilLine', line: 'Work problems on a drawing board and get each one graded.' },
  { key: 'library', label: 'Library', icon: 'BookOpen', line: 'Every guide, note and lecture, sorted by class.' },
  { key: 'calendar', label: 'Calendar', icon: 'Calendar', line: 'Canvas deadlines and your study blocks in one week.' },
  { key: 'week', label: 'Plan my week', icon: 'CalendarCheck', line: 'Fit what’s due into the free time you have.' },
  { key: 'progress', label: 'Progress', icon: 'ChartLine', line: 'Your streak, study time and what you know.' },
];
export const MORE_TOOL = { key: 'more', label: 'More tools', icon: 'Ellipsis', line: 'Record a lecture, NCLEX practice, Study now, Dashboard and the Assistant.' };

// More tools: every other tool in the feature map (docs/redesign/PLAN.md) that lives under
// "Rail › More tools". NCLEX shows only when the student has nursing material.
export const MORE_TOOLS = [
  { key: 'new', label: 'New', icon: 'Plus', meta: 'Upload, paste, a link, record or a sample' },
  { key: 'write', label: 'Write cards', icon: 'PenLine', meta: 'Write your own cards or import a set', href: '/create' },
  { key: 'record', label: 'Record lecture', icon: 'Mic', meta: 'Notes write themselves as the class goes' },
  { key: 'nclex', label: 'NCLEX', icon: 'Stethoscope', meta: 'Nursing questions in the NCLEX style', nursing: true },
  { key: 'study', label: 'Study now', icon: 'Zap', meta: 'Today’s due cards from every guide', href: '/session' },
  { key: 'dashboard', label: 'Dashboard', icon: 'House', meta: 'Continue, class updates and course work', href: '/dashboard' },
  { key: 'assistant', label: 'Assistant', icon: 'MessageCircle', meta: 'Cordia Assistant settings', href: '/assistant' },
];

export function moreTools({ nursing = false } = {}) {
  return MORE_TOOLS.filter(item => !item.nursing || nursing);
}

const one = value => (Array.isArray(value) ? value[0] : value);

// The guide the page is about, so a tool opens on the same material.
export function pageGuideId(pathname, query = {}) {
  if (pathname === '/guide/[id]') return String(one(query.id) || '');
  if (['/learn/[guideId]', '/quiz/[guideId]', '/nclex/[guideId]', '/practice/[guideId]', '/flashcards/study'].includes(pathname)) return String(one(query.guideId) || '');
  return '';
}

// Where a tool goes outside a chat: its own page, on the page's guide when there is one, otherwise
// the Library list where a set is picked for it. Make guide and New open the New sheet (null).
export function toolHref(key, pathname = '', query = {}) {
  const guide = encodeURIComponent(pageGuideId(pathname, query));
  switch (key) {
    case 'learn': return guide ? `/learn/${guide}` : '/library?filter=learn';
    case 'flashcards': return guide ? `/flashcards/study?guideId=${guide}` : '/library?filter=flashcards';
    case 'quiz': return guide ? `/quiz/${guide}` : '/library?filter=guides';
    case 'practice': return guide ? `/practice/${guide}` : '/practice';
    case 'nclex': return guide ? `/nclex/${guide}` : '/library?filter=guides';
    case 'library': return '/library';
    case 'calendar': return '/calendar';
    case 'week': return '/week';
    case 'progress': return '/progress';
    default: return MORE_TOOLS.find(item => item.key === key)?.href || null;
  }
}

const MORE_PATHS = ['/dashboard', '/assistant', '/session', '/create', '/nclex/[guideId]'];
const LIBRARY_PAGES = ['/library', '/guide/[id]', '/smartnotes', '/lecture/[id]'];

// The one rail button for this page, or '' (DESIGN-SPEC 3.4: the tool whose page is open).
export function railCurrent(pathname) {
  if (pathname === '/learn/[guideId]') return 'learn';
  if (pathname === '/flashcards/study') return 'flashcards';
  if (pathname === '/quiz/[guideId]') return 'quiz';
  if (pathname === '/practice' || pathname === '/practice/[guideId]') return 'practice';
  if (LIBRARY_PAGES.includes(pathname)) return 'library';
  if (pathname === '/calendar' || pathname.startsWith('/calendar/')) return 'calendar';
  if (pathname === '/week') return 'week';
  if (pathname === '/progress') return 'progress';
  if (MORE_PATHS.includes(pathname)) return 'more';
  return '';
}

// The one sidebar item for this page, or '': 'new' (a new Tutor chat), 'chat:live' (the Tutor's
// open conversation), 'class:<id>' (a class listed in the sidebar), 'account' (Settings, Billing).
export function sidebarCurrent(pathname, query = {}, { classIds = [], liveChat = false } = {}) {
  if (pathname === '/tutor') return liveChat ? 'chat:live' : 'new';
  if (pathname === '/folder/[id]' && classIds.includes(String(one(query.id) || ''))) return 'class:' + one(query.id);
  if (pathname === '/settings' || pathname.startsWith('/settings/') || pathname === '/billing') return 'account';
  return '';
}

// A chat's title, the way the server names a saved chat: the first thing the student asked.
export function chatTitle(messages) {
  const first = (messages || []).find(message => message?.role === 'user' && message.text);
  const title = String(first?.text || '').split(/\s+/).filter(Boolean).join(' ');
  return title.length > 80 ? title.slice(0, 77) + '…' : title || 'Tutor chat';
}

// Recent chats, newest first: the Tutor's open conversation (when it has messages), then the
// saved ones (GET /tutor/chats, newest first). Saved chats open at /tutor?chat=<id>.
export function recentChats(liveMessages, saved, limit = 30) {
  const live = (liveMessages || []).some(message => message?.role === 'user')
    ? [{ key: 'chat:live', id: '', title: chatTitle(liveMessages), href: '/tutor' }]
    : [];
  const rest = (Array.isArray(saved) ? saved : []).filter(chat => chat?.id).map(chat => ({
    key: 'chat:' + chat.id, id: String(chat.id), title: String(chat.title || '').trim() || 'Tutor chat', href: '/tutor?chat=' + encodeURIComponent(chat.id),
  }));
  return [...live, ...rest].slice(0, limit);
}

// Classes in the sidebar: up to five, by course code (DESIGN-SPEC 3.2).
export const MAX_CLASSES = 5;
