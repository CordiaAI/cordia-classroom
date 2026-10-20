import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  CalendarDays, CircleHelp, CreditCard, Library, LogOut, MessageCircle, NotebookPen, Palette, Plus, Search, Sun, User,
} from 'lucide-react';
import { apiFetch, cacheUserIdentity, clearAuth, getUserEmail, getUserName } from '../lib/api';
import FeedbackModal from './FeedbackModal';
import AcademicInfinityMark from './AcademicInfinityMark';
import SearchModal from './SearchModal';
import HelpSheet from './HelpSheet';
import AccountMenu from './AccountMenu';
import { openNewSheet } from '../lib/newSheet';

// One navigation: the same five places on the glass top bar and the mobile tab bar.
const navItems = [
  { label: 'Today', href: '/dashboard', icon: Sun, spot: 'nav-today' },
  { label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { label: 'Tutor', href: '/tutor', icon: MessageCircle, spot: 'nav-tutor' },
  { label: 'Notes', href: '/smartnotes', icon: NotebookPen, spot: 'nav-notes' },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar' },
];

// Guide, flashcard, Retain and Practice screens all live inside Library.
const LIBRARY_PATHS = ['/library', '/guide', '/flashcards', '/quiz', '/practice', '/nclex', '/folder', '/create', '/session', '/class'];

export function activeNavHref(pathname) {
  if (pathname === '/dashboard') return '/dashboard';
  if (LIBRARY_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) return '/library';
  if (pathname.startsWith('/tutor')) return '/tutor';
  if (pathname.startsWith('/smartnotes')) return '/smartnotes';
  if (pathname.startsWith('/calendar')) return '/calendar';
  return '';
}

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
}

export default function Sidebar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [canReviewFeedback, setCanReviewFeedback] = useState(false);
  const [shortcut, setShortcut] = useState('Ctrl K');
  const avatarRef = useRef(null);
  const active = activeNavHref(router.pathname);

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
    };
    const openSearch = () => setShowSearch(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cordia:search', openSearch);
    return () => { alive = false; window.removeEventListener('keydown', onKey); window.removeEventListener('cordia:search', openSearch); };
  }, []);

  // Closing returns focus to the avatar (Escape, choosing an item); an outside click leaves focus where it landed.
  const closeMenu = useCallback(refocus => {
    setMenuOpen(false);
    if (refocus) avatarRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeAll = () => { setMenuOpen(false); setShowSearch(false); };
    router.events.on('routeChangeStart', closeAll);
    return () => router.events.off('routeChangeStart', closeAll);
  }, [router.events]);

  const accountItems = [
    { key: 'profile', label: 'Profile', icon: User, onSelect: () => router.push('/settings') },
    { key: 'appearance', label: 'Appearance', icon: Palette, onSelect: () => router.push('/settings?section=appearance') },
    { key: 'plan', label: 'Plan', icon: CreditCard, onSelect: () => router.push('/settings?section=plan') },
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
  const onProfile = router.pathname === '/settings' || router.pathname === '/billing';

  return (
    <>
      <a className="workspace-skip-link" href="#classroom-main">Skip to content</a>
      <header className="c-topbar">
        <Link className="c-brand" href="/dashboard" aria-label="Cordia Classroom, Today">
          <AcademicInfinityMark className="top-navigation-mark" title="" />
          <span>cordia</span>
        </Link>

        <nav className="c-nav" aria-label="Primary">
          {navItems.map(item => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-tip={item.href === '/calendar' ? 'calendar' : undefined} data-spot={item.spot}>
              <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="c-bar-actions">
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
        {navItems.map(item => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-spot={item.spot}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <button type="button" className="c-btn c-btn--primary c-fab" data-spot="new" onClick={() => openNewSheet()}>
        <Plus size={20} strokeWidth={1.75} aria-hidden="true" />New
      </button>

      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      {showHelp && (
        <HelpSheet
          onClose={() => setShowHelp(false)}
          onFeedback={() => { setShowHelp(false); setShowFeedback(true); }}
          canReviewFeedback={canReviewFeedback}
        />
      )}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  );
}
