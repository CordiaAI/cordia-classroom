import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AudioLines, BookOpen, CalendarDays, ChartNoAxesColumn, ChevronRight, CircleHelp, CreditCard, Folder, FolderPlus, GraduationCap, Layers, House, Library, Link2, LogOut, MessageCircle, Megaphone, Palette, PanelLeftClose, PanelLeftOpen, PencilRuler, Plus, Search, Settings, User } from 'lucide-react';
import { apiFetch, cacheUserIdentity, clearAuth, getUserEmail, getUserName } from '../lib/api';
import FeedbackModal from './FeedbackModal';
import AcademicInfinityMark from './AcademicInfinityMark';
import SearchModal from './SearchModal';
import HelpSheet from './HelpSheet';
import AccountMenu from './AccountMenu';
import ShortcutsSheet from './ShortcutsSheet';
import StudyTimer from './StudyTimer';
import TutorBubble from './TutorBubble';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';
import { classLabel } from '../lib/classLabel';

// One navigation: the same three places on the glass top bar and the mobile tab bar, plus New.
// The Tutor is the bubble in the corner (TutorBubble). Calendar is its own place: study blocks and
// lecture to-dos show without Canvas, and Canvas adds its deadlines when connected.
const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: House, spot: 'nav-today' },
  { label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar', tip: 'calendar' },
  // Not on the phone tab bar (five fit); the calendar's connect card and the dashboard reach it.
  { label: 'Canvas', href: '/canvas', icon: GraduationCap, spot: 'nav-canvas', phone: false },
  // Cordia Assistant has its own page (pages/assistant.js).
  { label: 'Assistant', href: '/assistant', icon: MessageCircle, spot: 'nav-assistant' },
];

// The sidebar's Study section: Library's filters, one tap each (Tutor is the corner bubble and
// Progress is in the account menu).
const onFilter = key => (path, query) => path === '/library' && (query.tab || query.filter) === key;
const studyItems = [
  { label: 'Guides', href: '/library?tab=guides', icon: BookOpen, here: onFilter('guides') },
  { label: 'Lectures', href: '/library?tab=lectures', icon: AudioLines, here: onFilter('lectures') },
  { label: 'Flashcards', href: '/library?tab=flashcards', icon: Layers, here: (path, query) => onFilter('flashcards')(path, query) || onFilter('cards')(path, query) },
  { label: 'Practice', href: '/library?tab=practice', icon: PencilRuler, here: (path, query) => path.startsWith('/practice') || onFilter('practice')(path, query) },
];
const MAX_CLASSES = 8;
// Classes for the sidebar, kept between pages so it doesn't flash empty on each navigation.
let classCache = null;

// Guides, notes, lectures, classes and every study screen live inside Library.
const LIBRARY_PATHS = ['/library', '/guide', '/flashcards', '/quiz', '/practice', '/nclex', '/folder', '/create', '/session', '/class', '/smartnotes', '/lecture'];

export function activeNavHref(pathname, section = '') {
  if (pathname === '/dashboard') return '/dashboard';
  if (pathname === '/assistant') return '/assistant';
  if (LIBRARY_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) return '/library';
  if (pathname.startsWith('/calendar') || pathname === '/week') return '/calendar';
  if (pathname.startsWith('/canvas')) return '/canvas';
  return '';
}

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
}

export default function Sidebar({ timerState, setTimerState }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [canReviewFeedback, setCanReviewFeedback] = useState(false);
  const timerRef = useRef(null);
  const [shortcut, setShortcut] = useState('Ctrl K');
  const avatarRef = useRef(null);
  const sideAvatarRef = useRef(null);
  const [menuFrom, setMenuFrom] = useState('top'); // which avatar opened the account menu
  // Wide screens: the sidebar folds to icons. Remembered on this device; _document applies it before paint.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(document.documentElement.dataset.side === 'collapsed'); }, []);
  function toggleSide() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.side = next ? 'collapsed' : 'open';
    try { localStorage.setItem('cordiaSide', next ? 'collapsed' : 'open'); } catch { /* storage blocked */ }
  }
  const active = activeNavHref(router.pathname, String(router.query.section || ''));

  // Library and Canvas open into their own lists (Library: each class). Which are open is remembered.
  // Unset means "open while you're in it"; the caret sets it either way.
  const [groups, setGroups] = useState({ '/library': true });
  const [classes, setClasses] = useState(classCache || []);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem('cordiaSideGroups') || 'null'); if (saved) setGroups(saved); } catch { /* storage blocked */ }
  }, []);
  function toggleGroup(href, open) {
    setGroups(current => {
      const next = { ...current, [href]: !open };
      try { localStorage.setItem('cordiaSideGroups', JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  }
  // Classes load once, then again whenever Library or a class is opened (where they're added and renamed).
  const onClassPages = router.pathname === '/library' || router.pathname.startsWith('/folder');
  useEffect(() => {
    if (classCache && !onClassPages) return undefined;
    let live = true;
    apiFetch('/folders').then(data => {
      if (!live || !Array.isArray(data?.folders)) return;
      classCache = data.folders.map(folder => ({ id: folder.id, name: classLabel(folder.name).title || 'Class' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setClasses(classCache);
    });
    return () => { live = false; };
  }, [onClassPages, router.asPath]);
  const query = router.query || {};
  const subLink = (item, here) => (
    <li key={item.href}>
      <Link className="c-side-sub" href={item.href} aria-current={here ? 'page' : undefined} title={item.label}>
        <item.icon size={16} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">{item.label}</span>
      </Link>
    </li>
  );
  function subList(href) {
    if (href !== '/library') return null;
    return [
      ...classes.slice(0, MAX_CLASSES).map(folder => subLink({ label: folder.name, href: `/folder/${folder.id}`, icon: Folder }, router.pathname === '/folder/[id]' && query.id === folder.id)),
      classes.length > MAX_CLASSES && subLink({ label: `All ${classes.length} classes`, href: '/library', icon: Library }, false),
      subLink({ label: 'Add a class', href: '/library?add=class', icon: FolderPlus }, false),
    ].filter(Boolean);
  }

  useEffect(() => {
    setShortcut(isMac() ? '⌘K' : 'Ctrl K');
    setEmail(getUserEmail() || '');
    setName(getUserName() || '');
    let alive = true;
    apiFetch('/auth/me').then(identity => {
      if (!alive || !identity?.user_id) return;
      cacheUserIdentity(identity);
      setEmail(identity.email || getUserEmail() || '');
      setName(identity.name || getUserName() || '');
    });
    apiFetch('/feedback/reviewer-status').then(result => {
      if (alive) setCanReviewFeedback(Boolean(result?.reviewer));
    });
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowSearch(true);
      }
      // "?" lists every shortcut, except while typing.
      const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === '?' && !typing) setShowShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, []);

  // Closing returns focus to the avatar (Escape, choosing an item); an outside click leaves focus where it landed.
  const closeMenu = useCallback(refocus => {
    setMenuOpen(false);
    if (refocus) (menuFrom === 'side' ? sideAvatarRef : avatarRef).current?.focus({ preventScroll: true });
  }, [menuFrom]);

  useEffect(() => {
    const closeAll = () => { setMenuOpen(false); setShowSearch(false); setTimerOpen(false); };
    router.events.on('routeChangeStart', closeAll);
    return () => router.events.off('routeChangeStart', closeAll);
  }, [router.events]);

  // The focus timer popover closes on an outside click or Escape.
  useEffect(() => {
    if (!timerOpen) return undefined;
    const onDown = event => { if (!timerRef.current?.contains(event.target)) setTimerOpen(false); };
    const onKey = event => { if (event.key === 'Escape') setTimerOpen(false); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [timerOpen]);

  const accountItems = [
    { key: 'progress', label: 'Progress', icon: ChartNoAxesColumn, onSelect: () => router.push('/progress') },
    { key: 'profile', label: 'Settings', icon: Settings, onSelect: () => router.push('/settings') },
    { key: 'appearance', label: 'Appearance', icon: Palette, onSelect: () => router.push('/settings?section=appearance') },
    { key: 'plan', label: 'Plan', icon: CreditCard, onSelect: () => router.push('/settings?section=plan') },
    { key: 'connectors', label: 'Connectors', icon: Link2, onSelect: () => router.push('/settings?section=connectors') },
    { key: 'help', label: 'Help', icon: CircleHelp, onSelect: () => setShowHelp(true) },
    { key: 'feedback', label: 'Send feedback', icon: Megaphone, onSelect: () => setShowFeedback(true) },
    { key: 'signout', label: 'Sign out', icon: LogOut, separated: true, onSelect: () => signOut() },
  ];

  function signOut() {
    clearAuth();
    router.push('/');
  }

  // Initials come only from the real name, or from the email's local part ("jane.doe" -> JD).
  const emailName = email ? email.split('@')[0] : '';
  const displayName = name || emailName;
  const initials = (name ? name.split(/\s+/) : emailName.split(/[._-]+/))
    .filter(part => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  const onProfile = ['/settings', '/billing', '/progress'].includes(router.pathname);
  const { minutes = 25, seconds = 0, isRunning = false } = timerState || {};
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <>
      <a className="workspace-skip-link" href="#classroom-main">Skip to content</a>
      {/* Wide screens: the sidebar. Every item has a label; folded, the label shows on hover. */}
      <aside className={'c-side' + (collapsed ? ' is-collapsed' : '')} aria-label="Sidebar">
        <div className="c-side-head">
          <Link className="c-side-brand" href="/dashboard" aria-label="Cordia Classroom, Dashboard">
            <AcademicInfinityMark className="top-navigation-mark" title="" />
            <span className="c-side-label">cordia</span>
          </Link>
          <button type="button" className="c-side-toggle" onClick={toggleSide} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
        <button type="button" className="c-btn c-btn--primary c-side-new" data-spot="new" onClick={() => openNewSheet()} title="New">
          <Plus size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">New</span>
        </button>
        <button type="button" className="c-side-item" onClick={() => setShowSearch(true)} title={`Search (${shortcut})`} aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'}>
          <Search size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Search</span><kbd className="c-side-kbd">{shortcut}</kbd>
        </button>
        <nav className="c-side-nav" aria-label="Primary">
          {navItems.map(item => {
            const hasSub = item.href === '/library';
            const open = hasSub && !collapsed && (groups[item.href] ?? active === item.href);
            return (
              <div key={item.href} className="c-side-group">
                <div className="c-side-row">
                  <Link className="c-side-item" href={item.href} aria-current={active === item.href ? 'page' : undefined} data-tip={item.tip} data-spot={item.spot} title={item.label}>
                    <item.icon size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">{item.label}</span>
                  </Link>
                  {hasSub && (
                    <button type="button" className={'c-side-caret' + (open ? ' is-open' : '')} onClick={() => toggleGroup(item.href, open)} aria-expanded={Boolean(open)} aria-label={`${open ? 'Hide' : 'Show'} classes`}>
                      <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {open && <ul className="c-side-subs">{subList(item.href)}</ul>}
              </div>
            );
          })}
          <div className="c-side-section">
            <h2 className="c-side-heading">Study</h2>
            {studyItems.map(item => (
              <Link key={item.href} className="c-side-item is-study" href={item.href} aria-current={item.here(router.pathname, query) ? 'page' : undefined} title={item.label}>
                <item.icon size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
        <div className="c-side-foot">
          <button type="button" className="c-side-item" onClick={() => setShowHelp(true)} title="Help">
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Help</span>
          </button>
          <button type="button" className="c-side-item" onClick={() => setShowFeedback(true)} title="Send feedback">
            <Megaphone size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Send feedback</span>
          </button>
          <button ref={sideAvatarRef} type="button" className={'c-side-item c-side-account' + (onProfile ? ' is-active' : '')} onClick={() => { setMenuFrom('side'); setMenuOpen(open => !open); }} aria-expanded={menuOpen && menuFrom === 'side'} aria-haspopup="menu" title={displayName || 'Account'}>
            <span className="c-avatar c-side-avatar" aria-hidden="true">{initials || <User size={18} strokeWidth={1.75} />}</span>
            <span className="c-side-label c-side-who"><strong className="c-truncate">{name || emailName || 'Account'}</strong>{email && <span className="c-truncate">{email}</span>}</span>
          </button>
        </div>
      </aside>

      {/* Phones: brand, search and account on top; the tab bar below. */}
      <header className="c-topbar">
        <Link className="c-brand" href="/dashboard" aria-label="Cordia Classroom, Dashboard">
          <AcademicInfinityMark className="top-navigation-mark" title="" />
          <span>cordia</span>
        </Link>

        <nav className="c-nav" aria-label="Primary">
          {navItems.map(item => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-tip={item.tip} data-spot={item.spot}>
              <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="c-bar-actions">
          {/* Search is an icon: the ⌘K / Ctrl K shortcut shows on hover. */}
          <button type="button" className="c-btn c-btn--secondary c-searchbtn" onClick={() => setShowSearch(true)} aria-label={`Search (${shortcut})`} title={`Search (${shortcut})`} aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'}>
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="c-btn c-btn--primary c-new-btn" data-spot="new" onClick={() => openNewSheet()}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />New
          </button>
          <div className="c-menu-wrap">
            <button ref={avatarRef} type="button" className={'c-avatar' + (onProfile ? ' is-active' : '')} onClick={() => { setMenuFrom('top'); setMenuOpen(open => !open); }} aria-expanded={menuOpen && menuFrom === 'top'} aria-haspopup="menu" aria-label={initials ? `${initials} account menu` : 'Account menu'}>
              {initials || <User size={20} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            {/* The sidebar has its own Help and Send feedback, so its account menu leaves them out. */}
            <AccountMenu open={menuOpen} onClose={closeMenu} anchorRef={menuFrom === 'side' ? sideAvatarRef : avatarRef} placement={menuFrom === 'side' ? 'above' : 'below'}
              items={menuFrom === 'side' ? accountItems.filter(item => item.key !== 'help' && item.key !== 'feedback') : accountItems} />
          </div>
        </div>
      </header>

      <nav className="c-tabbar" aria-label="Primary">
        {navItems.slice(0, 2).map(item => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-spot={item.spot}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
        <button type="button" className="c-tab-new" data-spot="new" onClick={() => openNewSheet()} aria-label="New">
          <span className="c-tab-new-dot"><Plus size={22} strokeWidth={2} aria-hidden="true" /></span>
          New
        </button>
        {navItems.slice(2).filter(item => item.phone !== false).map(item => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-spot={item.spot}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <TutorBubble />

      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      {showHelp && (
        <HelpSheet
          onClose={() => setShowHelp(false)}
          onFeedback={() => { setShowHelp(false); setShowFeedback(true); }}
          onShortcuts={() => { setShowHelp(false); setShowShortcuts(true); }}
          canReviewFeedback={canReviewFeedback}
        />
      )}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showShortcuts && <ShortcutsSheet onClose={() => setShowShortcuts(false)} />}
    </>
  );
}
