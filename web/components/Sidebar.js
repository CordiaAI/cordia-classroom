import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CalendarDays, ChartNoAxesColumn, CircleHelp, CreditCard, Ellipsis, FolderPlus, House, Library, Link2, LogOut, MessageCircle, Megaphone, Moon, Palette, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun, User } from 'lucide-react';
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
import { coverFor } from '../lib/coverDesign.mjs';
import { latestFolders, loadFolders, onFoldersChanged } from '../lib/folders';
import { HELP_EVENT } from '../lib/help';
import { setThemePreference, themePreference } from '../lib/theme';

// The sidebar (wide screens), top to bottom: New, Search, the main places, your classes, the
// Assistant, then the account row with its menu. Study modes (guides, Learn, lectures, flashcards,
// practice) are Library filters and guide tabs; Canvas is in Settings › Connectors and on the
// Dashboard. The Tutor is the bubble in the corner (TutorBubble).
const navItems = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: House, spot: 'nav-today' },
  { key: 'library', label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { key: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar', tip: 'calendar' },
  { key: 'progress', label: 'Progress', href: '/progress', icon: ChartNoAxesColumn, spot: 'nav-progress' },
];
// Cordia Assistant has its own page (pages/assistant.js); it sits under the classes.
const assistantItem = { key: 'assistant', label: 'Assistant', href: '/assistant', icon: MessageCircle, spot: 'nav-assistant' };

// The phone tab bar keeps its five: Dashboard, Library, New (between them), Calendar, Assistant.
const tabItems = [
  { label: 'Dashboard', href: '/dashboard', icon: House, spot: 'nav-today' },
  { label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar' },
  { label: 'Assistant', href: '/assistant', icon: MessageCircle, spot: 'nav-assistant' },
];

// Classes: the first five by what the sidebar shows (course code, else name), each with its cover colour.
export const MAX_CLASSES = 5;
export function sidebarClasses(folders) {
  return (folders || []).map(folder => {
    const { title, code } = classLabel(folder.name);
    return { id: folder.id, name: title || 'Class', code: code || title || 'Class', tone: (coverFor(folder).color % 8) + 1 };
  }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

// Guides, notes, lectures, classes and every study screen live inside Library (the phone tab bar).
const LIBRARY_PATHS = ['/library', '/guide', '/flashcards', '/quiz', '/practice', '/nclex', '/learn', '/folder', '/create', '/session', '/class', '/smartnotes', '/lecture'];

export function activeNavHref(pathname, section = '') {
  if (pathname === '/dashboard') return '/dashboard';
  if (pathname === '/assistant') return '/assistant';
  if (LIBRARY_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) return '/library';
  if (pathname.startsWith('/calendar') || pathname === '/week') return '/calendar';
  if (pathname.startsWith('/canvas')) return '/canvas';
  return '';
}

// The one sidebar item for this page: a nav key, 'class:<id>' for a class listed in the sidebar,
// or '' (Settings and other pages outside the list). Only that item is marked current.
export function sideCurrent(pathname, query = {}, classIds = []) {
  if (pathname === '/progress') return 'progress';
  if (pathname === '/folder/[id]' && classIds.includes(String(query.id || ''))) return 'class:' + query.id;
  const href = activeNavHref(pathname);
  if (href === '/canvas') return '';
  return href ? href.slice(1) : '';
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
  const [dark, setDark] = useState(false);
  const timerRef = useRef(null);
  const [shortcut, setShortcut] = useState('Ctrl K');
  const avatarRef = useRef(null);
  const sideAvatarRef = useRef(null);
  const [menuFrom, setMenuFrom] = useState('top'); // which avatar opened the account menu
  // Wide screens: the sidebar folds to icons. Remembered on this device; _document applies it before paint.
  // From 768 to 1099px it is always folded (system.css), so it counts as folded there too.
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.side === 'collapsed');
    const media = window.matchMedia('(max-width: 1099px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function toggleSide() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.side = next ? 'collapsed' : 'open';
    try { localStorage.setItem('cordiaSide', next ? 'collapsed' : 'open'); } catch { /* storage blocked */ }
  }
  // Names show as tooltips only when folded to icons; with labels showing they'd only repeat them.
  const folded = collapsed || narrow;
  const tip = label => (folded ? label : undefined);
  const active = activeNavHref(router.pathname, String(router.query.section || ''));

  // Classes come from the shared folders list, and again whenever a class is added, renamed or deleted.
  const [classes, setClasses] = useState(() => (latestFolders() ? sidebarClasses(latestFolders()) : null));
  useEffect(() => {
    let live = true;
    const load = () => loadFolders().then(data => { if (live && Array.isArray(data?.folders)) setClasses(sidebarClasses(data.folders)); });
    load();
    const off = onFoldersChanged(load);
    return () => { live = false; off(); };
  }, []);
  const shownClasses = (classes || []).slice(0, MAX_CLASSES);
  const query = router.query || {};
  const current = sideCurrent(router.pathname, query, shownClasses.map(item => String(item.id)));

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
    // Help opens from anywhere (Learn Cordia's "See all", old Settings links).
    const onHelp = () => setShowHelp(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(HELP_EVENT, onHelp);
    return () => { alive = false; window.removeEventListener('keydown', onKey); window.removeEventListener(HELP_EVENT, onHelp); };
  }, []);

  // Closing returns focus to the avatar (Escape, choosing an item); an outside click leaves focus where it landed.
  const closeMenu = useCallback(refocus => {
    setMenuOpen(false);
    if (refocus) (menuFrom === 'side' ? sideAvatarRef : avatarRef).current?.focus({ preventScroll: true });
  }, [menuFrom]);
  function toggleMenu(from) {
    setDark(themePreference() === 'dark');
    setMenuFrom(from);
    setMenuOpen(open => !open);
  }

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

  // The phone top bar's menu has everything; the sidebar's has Settings, Help, Send feedback,
  // the theme and Sign out (Progress is in the sidebar; Appearance, Plan and Connectors are in Settings).
  const accountItems = [
    { key: 'progress', label: 'Progress', icon: ChartNoAxesColumn, onSelect: () => router.push('/progress') },
    { key: 'profile', label: 'Settings', icon: Settings, onSelect: () => router.push('/settings') },
    { key: 'appearance', label: 'Appearance', icon: Palette, onSelect: () => router.push('/settings?section=account') },
    { key: 'plan', label: 'Plan', icon: CreditCard, onSelect: () => router.push('/settings?section=plan') },
    { key: 'connectors', label: 'Connectors', icon: Link2, onSelect: () => router.push('/settings?section=connectors') },
    { key: 'help', label: 'Help', icon: CircleHelp, onSelect: () => setShowHelp(true) },
    { key: 'feedback', label: 'Send feedback', icon: Megaphone, onSelect: () => setShowFeedback(true) },
    { key: 'signout', label: 'Sign out', icon: LogOut, separated: true, onSelect: () => signOut() },
  ];
  const themeItem = { key: 'theme', label: dark ? 'Light theme' : 'Dark theme', icon: dark ? Sun : Moon, onSelect: () => setThemePreference(dark ? 'light' : 'dark') };
  const sideMenuItems = [
    ...accountItems.filter(item => ['profile', 'help', 'feedback'].includes(item.key)),
    themeItem,
    ...accountItems.filter(item => item.key === 'signout'),
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
  const onProfile = ['/settings', '/billing'].includes(router.pathname);
  const { minutes = 25, seconds = 0, isRunning = false } = timerState || {};
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const sideLink = item => (
    <Link key={item.key} className="c-side-item" href={item.href} aria-current={current === item.key ? 'page' : undefined} data-tip={item.tip} data-spot={item.spot} title={tip(item.label)}>
      <item.icon size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">{item.label}</span>
    </Link>
  );

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
          <button type="button" className="c-side-toggle" onClick={toggleSide} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={tip('Expand sidebar')} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
        <button type="button" className="c-btn c-btn--primary c-side-new" data-spot="new" onClick={() => openNewSheet()} aria-label="New" title={tip('New')}>
          <Plus size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">New</span>
        </button>
        <button type="button" className="c-side-item" onClick={() => setShowSearch(true)} aria-label={`Search (${shortcut})`} title={tip(`Search (${shortcut})`)} aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'}>
          <Search size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Search</span><kbd className="c-side-kbd" aria-hidden="true">{shortcut}</kbd>
        </button>
        <nav className="c-side-nav" aria-label="Primary">
          {navItems.map(sideLink)}
          <div className="c-side-section" role="group" aria-labelledby="c-side-classes">
            <div className="c-side-heading-row">
              <h2 id="c-side-classes" className="c-side-heading">Classes</h2>
              <Link className="c-side-add" href="/library?add=class" aria-label="Add a class">
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
            {classes && classes.length > 0 && (
              <ul className="c-side-classes">
                {shownClasses.map(item => (
                  <li key={item.id}>
                    <Link className="c-side-item c-side-class" href={`/folder/${item.id}`} aria-current={current === 'class:' + item.id ? 'page' : undefined}
                      aria-label={item.code === item.name ? item.name : `${item.code}, ${item.name}`} title={tip(item.code)}>
                      <span className="c-side-dot" style={{ '--dot': `var(--cover-ink-${item.tone})` }} aria-hidden="true" />
                      <span className="c-side-label">{item.code}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {classes && classes.length > MAX_CLASSES && <Link className="c-side-all" href="/library">See all {classes.length}</Link>}
            {classes && classes.length === 0 && (
              <Link className="c-side-item c-side-empty" href="/library?add=class" title={tip('Add a class')}>
                <FolderPlus size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Add a class</span>
              </Link>
            )}
          </div>
          {sideLink(assistantItem)}
        </nav>
        <div className="c-side-foot">
          <button ref={sideAvatarRef} type="button" className={'c-side-item c-side-account' + (onProfile ? ' is-active' : '')} onClick={() => toggleMenu('side')} aria-expanded={menuOpen && menuFrom === 'side'} aria-haspopup="menu"
            aria-label={`${displayName || 'Account'}, account menu`} title={tip(displayName || 'Account')}>
            <span className="c-avatar c-side-avatar" aria-hidden="true">{initials || <User size={18} strokeWidth={1.75} />}</span>
            <span className="c-side-label c-side-who"><strong className="c-truncate">{name || emailName || 'Account'}</strong>{email && <span className="c-truncate">{email}</span>}</span>
            <Ellipsis className="c-side-dots" size={18} strokeWidth={1.75} aria-hidden="true" />
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
          {[...navItems, assistantItem].map(item => (
            <Link key={item.href} href={item.href} aria-current={current === item.key ? 'page' : undefined} data-tip={item.tip} data-spot={item.spot}>
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
            <button ref={avatarRef} type="button" className={'c-avatar' + (onProfile ? ' is-active' : '')} onClick={() => toggleMenu('top')} aria-expanded={menuOpen && menuFrom === 'top'} aria-haspopup="menu" aria-label={initials ? `${initials} account menu` : 'Account menu'}>
              {initials || <User size={20} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            <AccountMenu open={menuOpen} onClose={closeMenu} anchorRef={menuFrom === 'side' ? sideAvatarRef : avatarRef} placement={menuFrom === 'side' ? 'above' : 'below'}
              items={menuFrom === 'side' ? sideMenuItems : accountItems} />
          </div>
        </div>
      </header>

      <nav className="c-tabbar" aria-label="Primary">
        {tabItems.slice(0, 2).map(item => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-spot={item.spot}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
        <button type="button" className="c-tab-new" data-spot="new" onClick={() => openNewSheet()} aria-label="New">
          <span className="c-tab-new-dot"><Plus size={22} strokeWidth={2} aria-hidden="true" /></span>
          New
        </button>
        {tabItems.slice(2).map(item => (
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
