import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ChartNoAxesColumn, CircleHelp, CreditCard, GraduationCap, LayoutDashboard, Library, Link2, LogOut, MessageCircle, Palette, Plus, Search, Settings, Timer, User,
} from 'lucide-react';
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

// One navigation: the same three places on the glass top bar and the mobile tab bar, plus New.
// The Tutor is the bubble in the corner (TutorBubble); the calendar lives inside Canvas.
const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, spot: 'nav-today' },
  { label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { label: 'Canvas', href: '/canvas', icon: GraduationCap, spot: 'nav-canvas', tip: 'calendar' },
  // Cordia Assistant's settings live in Settings → Assistant.
  { label: 'Assistant', href: '/settings?section=assistant', icon: MessageCircle, spot: 'nav-assistant' },
];

// Guides, notes, lectures, classes and every study screen live inside Library.
const LIBRARY_PATHS = ['/library', '/guide', '/flashcards', '/quiz', '/practice', '/nclex', '/folder', '/create', '/session', '/class', '/smartnotes', '/lecture'];

export function activeNavHref(pathname, section = '') {
  if (pathname === '/dashboard') return '/dashboard';
  if (pathname === '/settings' && section === 'assistant') return '/settings?section=assistant';
  if (LIBRARY_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) return '/library';
  if (pathname.startsWith('/canvas') || pathname.startsWith('/calendar')) return '/canvas';
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
  const active = activeNavHref(router.pathname, String(router.query.section || ''));

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
    if (refocus) avatarRef.current?.focus({ preventScroll: true });
  }, []);

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
          <div className="c-menu-wrap" ref={timerRef}>
            <button type="button" className={'c-btn c-btn--secondary c-timerbtn' + (isRunning ? ' is-running' : '')} data-spot="focus-btn" onClick={() => { if (!timerOpen) walkthroughEvent('focus-opened'); setTimerOpen(open => !open); }} aria-expanded={timerOpen} aria-label={isRunning ? `Focus timer, ${clock} left` : 'Focus timer'}>
              <Timer size={20} strokeWidth={1.75} aria-hidden="true" />
              {isRunning && <span className="c-timer-clock">{clock}</span>}
            </button>
            {timerOpen && <div className="c-timer-pop"><StudyTimer timerState={timerState} setTimerState={setTimerState} /></div>}
          </div>
          <button type="button" className="c-btn c-btn--secondary c-searchbtn" onClick={() => setShowSearch(true)} aria-label="Search" aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'}>
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>Search</span>
            <kbd>{shortcut}</kbd>
          </button>
          <button type="button" className="c-btn c-btn--primary c-new-btn" data-spot="new" onClick={() => openNewSheet()}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />New
          </button>
          <div className="c-menu-wrap">
            <button ref={avatarRef} type="button" className={'c-avatar' + (onProfile ? ' is-active' : '')} onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-haspopup="menu" aria-label={initials ? `${initials} account menu` : 'Account menu'}>
              {initials || <User size={20} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            <AccountMenu open={menuOpen} onClose={closeMenu} anchorRef={avatarRef} items={accountItems} />
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
        {navItems.slice(2).map(item => (
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
