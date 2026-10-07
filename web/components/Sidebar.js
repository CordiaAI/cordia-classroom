import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, cacheUserIdentity, clearAuth, getUserEmail, getUserName } from '../lib/api';
import FeedbackModal from './FeedbackModal';
import AcademicInfinityMark from './AcademicInfinityMark';
import InstallSidebarButton from './InstallSidebarButton';
import WorkspaceIcon from './WorkspaceIcon';

const navItems = [
  { label: 'Home', href: '/dashboard', match: '/dashboard' },
  { label: 'Study', href: '/dashboard?view=guides', match: 'view=guides' },
  { label: 'Tutor', action: 'tutor', match: 'tutor' },
  { label: 'Notes', href: '/smartnotes', match: '/smartnotes' },
  { label: 'Profile', href: '/settings', match: '/settings' },
];
const railItems = [
  { label: 'Home', icon: 'home', href: '/dashboard', match: '/dashboard' },
  { label: 'Study Guides', icon: 'study', href: '/dashboard?view=guides', match: 'view=guides' },
  { label: 'Tutor', icon: 'tutor', action: 'tutor', match: 'tutor' },
  { label: 'SmartNotes', icon: 'notes', href: '/smartnotes', match: '/smartnotes' },
  { label: 'Flashcards', icon: 'flashcards', href: '/flashcards', match: '/flashcards' },
  { label: 'Practice', icon: 'practice', href: '/practice', match: '/practice' },
  { label: 'Calendar', icon: 'calendar', href: '/dashboard?view=calendar', match: 'view=calendar' },
];

export default function Sidebar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [canReviewFeedback, setCanReviewFeedback] = useState(false);
  const menuRef = useRef(null);
  const navRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [tutorActive, setTutorActive] = useState(false);
  const [tutorSelected, setTutorSelected] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem('cordiaRailCollapsed') === 'true');
    setTutorActive(localStorage.getItem('cordiaTutorOpen') === 'true');
    const updateTutor = event => {
      setTutorActive(Boolean(event.detail?.open));
      setTutorSelected(Boolean(event.detail?.open));
    };
    window.addEventListener('cordia:tutor-visibility', updateTutor);
    return () => window.removeEventListener('cordia:tutor-visibility', updateTutor);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const selected = nav.querySelector('button.active');
      setIndicator(selected ? { left: selected.offsetLeft, width: selected.offsetWidth } : { left: 0, width: 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [router.asPath, tutorActive, tutorSelected]);

  function openDestination(item) {
    if (item.action === 'tutor') {
      const inlineTutor = document.querySelector('.study-scene-tutor');
      if (inlineTutor) {
        inlineTutor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        inlineTutor.querySelector('textarea')?.focus({ preventScroll: true });
      } else window.dispatchEvent(new CustomEvent('cordia:tutor-toggle'));
    }
    else {
      setTutorSelected(false);
      router.push(item.href);
    }
  }

  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('cordiaRailCollapsed', String(next));
  }

  useEffect(() => {
    setEmail(getUserEmail() || '');
    setName(getUserName() || '');
    setTheme(localStorage.getItem('theme') || 'light');

    let active = true;
    apiFetch('/auth/me').then(identity => {
      if (!active || !identity?.user_id) return;
      cacheUserIdentity(identity);
      setEmail(identity.email || getUserEmail() || '');
      setName(identity.name || getUserName() || '');
    });
    apiFetch('/feedback/reviewer-status').then(result => {
      if (active) setCanReviewFeedback(Boolean(result?.reviewer));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function closeOnDocument(event) {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.type === 'mousedown' && menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    }
    const closeOnRoute = () => { setMenuOpen(false); setTutorSelected(false); };
    document.addEventListener('keydown', closeOnDocument);
    document.addEventListener('mousedown', closeOnDocument);
    router.events.on('routeChangeStart', closeOnRoute);
    return () => {
      document.removeEventListener('keydown', closeOnDocument);
      document.removeEventListener('mousedown', closeOnDocument);
      router.events.off('routeChangeStart', closeOnRoute);
    };
  }, [router.events]);

  function isActive(item) {
    if (item.match === 'tutor') return tutorActive && (!navItems.includes(item) || tutorSelected);
    if (tutorActive && tutorSelected && navItems.includes(item)) return false;
    if (item.match === '/dashboard') return router.pathname === '/dashboard' && !router.query.view;
    if (item.match === 'view=guides') return (router.pathname === '/dashboard' && router.query.view === 'guides') || router.pathname.startsWith('/flashcards') || router.pathname === '/create' || router.pathname.startsWith('/guide/');
    if (item.match.startsWith('view=')) return router.pathname === '/dashboard' && router.query.view === item.match.split('=')[1];
    return router.pathname.startsWith(item.match);
  }

  function setAppearance(theme) {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    setTheme(theme);
  }

  function signOut() {
    clearAuth();
    router.push('/');
  }

  // Initials come only from the real name, or from the email's local part
  // ("jane.doe" -> JD). Until identity loads the avatar stays blank; a placeholder
  // label must never be turned into initials.
  const emailName = email ? email.split('@')[0] : '';
  const displayName = name || emailName;
  const initials = (name ? name.split(/\s+/) : emailName.split(/[._-]+/))
    .filter(part => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();

  return (
    <>
      <a className="workspace-skip-link" href="#classroom-main">Skip to study content</a>
      <header className="top-navigation">
      <a className="top-navigation-brand" href="/dashboard" aria-label="CordiaClassroom dashboard">
        <AcademicInfinityMark className="top-navigation-mark" />
        <span className="cordia-wordmark">cordia</span>
        <small className="top-navigation-beta">beta</small>
      </a>

      <nav ref={navRef} className="top-navigation-links" aria-label="Primary navigation">
        {navItems.map(item => (
          <button key={item.label} type="button" className={isActive(item) ? 'active' : ''} aria-current={isActive(item) ? 'page' : undefined} onClick={() => openDestination(item)}>
            {item.label}
          </button>
        ))}
        <span className="navigation-indicator" aria-hidden="true" style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }} />
      </nav>

      <div className="top-navigation-actions">
        <div className="account-menu" ref={menuRef}>
          <button type="button" className="account-avatar" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Open account menu">
            {initials}
          </button>

          {menuOpen && (
            <div className="account-menu-panel" role="menu" aria-label="Account menu">
              <div className="account-menu-identity">
                <strong>{displayName || 'Your account'}</strong>
                <span>{email || 'CordiaClassroom account'}</span>
              </div>
              <button type="button" role="menuitem" onClick={() => router.push('/settings')}>Your profile</button>
              <button type="button" role="menuitem" onClick={() => router.push('/billing')}>Billing</button>
              <button type="button" role="menuitem" onClick={() => setShowFeedback(true)}>Feedback</button>
              <InstallSidebarButton />
              {canReviewFeedback && <button type="button" role="menuitem" onClick={() => router.push('/feedback-review')}>Review feedback</button>}
              <div className="account-theme-row">
                <span>Appearance</span>
                <button type="button" className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => setAppearance('light')}>Light</button>
                <button type="button" className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => setAppearance('dark')}>Dark</button>
              </div>
              <button type="button" role="menuitem" className="account-signout" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>

      </header>
      <aside className={`workspace-rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Classroom sidebar">
        <div className="workspace-rail-heading"><span>Classroom</span><button type="button" onClick={toggleRail} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}><WorkspaceIcon name="chevron" /></button></div>
        <button type="button" className="rail-create" onClick={() => router.push('/create')} title={collapsed ? 'New study guide' : undefined}><WorkspaceIcon name="upload" /><span>New study guide</span></button>
        <nav aria-label="Study navigation">
          {railItems.map(item => <button key={item.label} type="button" className={isActive(item) ? 'active' : ''} aria-current={isActive(item) ? 'page' : undefined} aria-label={item.label} title={collapsed ? item.label : undefined} onClick={() => openDestination(item)}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <div className="workspace-rail-footer"><span>Your space to understand.</span><button type="button" onClick={() => router.push('/settings')} aria-label="Your profile" title={collapsed ? 'Your profile' : undefined}><WorkspaceIcon name="profile" /><span>Your profile</span></button></div>
      </aside>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  );
}
