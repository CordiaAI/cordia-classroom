import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CalendarDays, ChartNoAxesColumn, CircleHelp, CreditCard, Ellipsis, House, Library, Link2, LogOut, MessageCircle, MessagesSquare, Megaphone, Moon, PanelLeftClose, PanelLeftOpen, Palette, Plus, Search, Settings, SquarePen, Sun, User, Users } from 'lucide-react';
import { apiFetch, cacheUserIdentity, clearAuth, getUserEmail, getUserName } from '../lib/api';
import FeedbackModal from './FeedbackModal';
import AcademicInfinityMark from './AcademicInfinityMark';
import BrandName from './BrandName';
import SearchModal from './SearchModal';
import HelpSheet from './HelpSheet';
import AccountMenu from './AccountMenu';
import ShortcutsSheet from './ShortcutsSheet';
import TutorBubble from './TutorBubble';
import NotificationBell from './NotificationBell';
import ProgressRing from './ProgressRing';
import ToolRail from './ToolRail';
import ShellMenu from './ShellMenu';
import { ShellTipLayer, useShellTips } from './ShellTips';
import { loadSocialSummary, onSocialSummary } from '../lib/social';
import { openNewSheet } from '../lib/newSheet';
import { classLabel } from '../lib/classLabel';
import { coverFor } from '../lib/coverDesign.mjs';
import { latestFolders, loadFolders, onFoldersChanged } from '../lib/folders';
import { HELP_EVENT } from '../lib/help';
import { setThemePreference, themePreference } from '../lib/theme';
import { tierName } from '../lib/plans';
import { loadClassReadiness } from '../lib/classReadiness';
import { liveMessages, loadSavedChats, onTutorChats } from '../lib/tutorChats';
import { MAX_CLASSES, recentChats, sidebarCurrent } from '../lib/shellTools.mjs';

// Phones (under 768px) keep the top bar and tab bar until the phone layout (T9). The top bar's
// links and its account menu cover the places; the tab bar keeps its five.
const navItems = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: House, spot: 'nav-today' },
  { key: 'library', label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { key: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar', tip: 'calendar' },
  { key: 'progress', label: 'Progress', href: '/progress', icon: ChartNoAxesColumn, spot: 'nav-progress' },
];
const assistantItem = { key: 'assistant', label: 'Assistant', href: '/assistant', icon: MessageCircle, spot: 'nav-assistant' };

// The phone tab bar keeps its five: Dashboard, Library, New (between them), Calendar, Assistant.
const tabItems = [
  { label: 'Dashboard', href: '/dashboard', icon: House, spot: 'nav-today' },
  { label: 'Library', href: '/library', icon: Library, spot: 'nav-library' },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, spot: 'nav-calendar' },
  { label: 'Assistant', href: '/assistant', icon: MessageCircle, spot: 'nav-assistant' },
];

// Classes: the first five by what the sidebar shows (course code, else name), each with its cover colour.
export function sidebarClasses(folders) {
  return (folders || []).map(folder => {
    const { title, code } = classLabel(folder.name);
    return { id: folder.id, name: title || 'Class', code: code || title || 'Class', tone: (coverFor(folder).color % 8) + 1 };
  }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

// Guides, notes, lectures, classes and every study screen live inside Library (the phone tab bar).
const LIBRARY_PATHS = ['/library', '/guide', '/flashcards', '/quiz', '/practice', '/nclex', '/learn', '/folder', '/create', '/session', '/class', '/smartnotes', '/lecture'];

export function activeNavHref(pathname) {
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

// The sidebar (DESIGN-SPEC 3.2), from 768px up: the mark and "cordia" with the bell and the fold
// toggle; New chat and Search; Classes (up to five, with a readiness ring when an exam is coming);
// Recent chats, which fill the rest and scroll; the account row. No tools: those are in the rail
// (components/ToolRail.js). Folded, it is 72px of icons, each with a tooltip and a name.
export default function Sidebar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('');
  const [school, setSchool] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [search, setSearch] = useState(null); // null, or { instant } while Search is open
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [canReviewFeedback, setCanReviewFeedback] = useState(false);
  // Friend and follow requests waiting on you: the badge on Friends in the account menu.
  const [requests, setRequests] = useState(0);
  const countRequests = summary => setRequests((summary?.incoming_friend_requests || 0) + (summary?.incoming_follow_requests || 0));
  useEffect(() => onSocialSummary(countRequests), []);
  useEffect(() => { loadSocialSummary().then(countRequests); }, [router.pathname]);
  const [dark, setDark] = useState(false);
  const [shortcut, setShortcut] = useState('Ctrl K');
  const avatarRef = useRef(null);
  const sideAvatarRef = useRef(null);
  const chatsRef = useRef(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [menuFrom, setMenuFrom] = useState('top'); // which avatar opened the account menu
  const { tip, bind, hide } = useShellTips();

  // Folds to icons, remembered on this device; _document applies it before paint. From 768 to
  // 1099px it is always folded (system.css), so it counts as folded there too.
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
    hide();
    setCollapsed(next);
    document.documentElement.dataset.side = next ? 'collapsed' : 'open';
    try { localStorage.setItem('cordiaSide', next ? 'collapsed' : 'open'); } catch { /* storage blocked */ }
  }
  const folded = collapsed || narrow;
  // Folded, every item shows its name as a tooltip; open, the labels already say it.
  const tipFor = key => (folded ? bind(key) : {});
  const active = activeNavHref(router.pathname);

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
  const classKey = shownClasses.map(item => item.id).join(',');

  // Readiness rings: Learn's own number for each class's next exam (lib/classReadiness.js). Asked
  // again after Learn, where it changes.
  const [readiness, setReadiness] = useState({});
  useEffect(() => {
    if (!classKey) { setReadiness({}); return undefined; }
    let live = true;
    let last = window.location.pathname;
    const load = fresh => loadClassReadiness(classKey.split(','), { fresh }).then(found => { if (live) setReadiness(found || {}); });
    load(false);
    const onRoute = url => {
      const fresh = last.startsWith('/learn/');
      last = String(url);
      load(fresh);
    };
    router.events.on('routeChangeComplete', onRoute);
    return () => { live = false; router.events.off('routeChangeComplete', onRoute); };
  }, [classKey, router.events]);

  // Recent chats: the Tutor's open conversation and its saved chats (until saved chats get their
  // own pages, T5).
  const [saved, setSaved] = useState([]);
  const [live, setLive] = useState(() => liveMessages());
  useEffect(() => {
    let alive = true;
    const reload = () => loadSavedChats().then(chats => { if (alive) setSaved(chats); });
    reload();
    const off = onTutorChats(({ saved: changed }) => { setLive(liveMessages()); if (changed) reload(); });
    return () => { alive = false; off(); };
  }, []);
  const chats = recentChats(live, saved);
  const query = router.query || {};
  const current = sidebarCurrent(router.pathname, query, {
    classIds: shownClasses.map(item => String(item.id)),
    liveChat: chats.some(chat => chat.key === 'chat:live'),
  });

  useEffect(() => {
    setShortcut(isMac() ? '⌘K' : 'Ctrl K');
    setEmail(getUserEmail() || '');
    setName(getUserName() || '');
    try { setSchool(localStorage.getItem('cordiaSchool') || ''); } catch { /* storage blocked */ }
    let alive = true;
    apiFetch('/auth/me').then(identity => {
      if (!alive || !identity?.user_id) return;
      cacheUserIdentity(identity);
      setEmail(identity.email || getUserEmail() || '');
      setName(identity.name || getUserName() || '');
    });
    apiFetch('/billing/status').then(status => {
      if (alive && status && !status.detail) setPlan(tierName(status.tier || (status.plan === 'free' ? 'free' : '')));
    });
    apiFetch('/feedback/reviewer-status').then(result => {
      if (alive) setCanReviewFeedback(Boolean(result?.reviewer));
    });
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        // From the keyboard: Search shows on the next frame, with no rise (DESIGN-SPEC 6.1).
        setSearch({ instant: true });
      }
      // TEMPORARY (owner request, for testing): Option+F / Alt+F opens Send feedback from anywhere,
      // even while typing. event.code, because Option+F on a Mac types "ƒ". Remove this block later.
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyF') {
        event.preventDefault();
        setShowFeedback(true);
        return;
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
    hide();
    setDark(themePreference() === 'dark');
    setMenuFrom(from);
    setMenuOpen(open => !open);
  }
  const closeChats = useCallback(refocus => {
    setChatsOpen(false);
    if (refocus) chatsRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeAll = () => { setMenuOpen(false); setSearch(null); setChatsOpen(false); };
    router.events.on('routeChangeStart', closeAll);
    return () => router.events.off('routeChangeStart', closeAll);
  }, [router.events]);

  // The phone top bar's menu has everything; the sidebar's has Settings, Plan, Friends, Help,
  // Send feedback, the theme and Sign out (Progress is in the rail).
  const accountItems = [
    { key: 'progress', label: 'Progress', icon: ChartNoAxesColumn, onSelect: () => router.push('/progress') },
    { key: 'friends', label: 'Friends', icon: Users, badge: requests || null, badgeLabel: `${requests} ${requests === 1 ? 'request' : 'requests'}`, onSelect: () => router.push('/friends') },
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
    ...accountItems.filter(item => ['profile', 'plan', 'friends', 'help', 'feedback'].includes(item.key))
      .map(item => (item.key === 'plan' && plan === 'Free' ? { ...item, label: 'Upgrade' } : item)),
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
  const planLine = [plan, school].filter(Boolean).join(' · ') || email;

  // New chat opens the Tutor on a new chat; on the Tutor page itself it starts one there.
  function newChat(event) {
    if (router.pathname === '/tutor' && !router.query.chat) {
      event.preventDefault();
      window.dispatchEvent(new Event('cordia:tutor-new'));
    }
  }
  // The open conversation reopens as it is; a saved chat reopens from /tutor?chat=<id>.
  function openChat(chat) {
    if (chat.key === 'chat:live') try { sessionStorage.setItem('cordiaTutorKeep', '1'); } catch { /* storage blocked */ }
  }

  const sideTips = [
    { key: 'toggle', title: collapsed ? 'Expand sidebar' : 'Collapse sidebar' },
    { key: 'bell', title: 'Notifications' },
    { key: 'new', title: 'New chat' },
    { key: 'search', title: `Search (${shortcut})` },
    { key: 'add', title: 'Add a class' },
    ...shownClasses.map(item => ({ key: 'class:' + item.id, title: readiness[item.id] ? `${item.code}, ${readiness[item.id].percent}% ready` : item.code })),
    { key: 'chats', title: 'Recent chats' },
    { key: 'account', title: displayName || 'Account' },
  ];

  return (
    <>
      <a className="workspace-skip-link" href="#classroom-main">Skip to content</a>
      <aside className={'c-side' + (collapsed ? ' is-collapsed' : '')} aria-label="Sidebar">
        <div className="c-side-head">
          <Link className="c-side-brand" href="/dashboard" aria-label="Cordia Classroom, Dashboard">
            <AcademicInfinityMark className="top-navigation-mark" title="" />
            <span className="c-side-label"><BrandName /></span>
          </Link>
          <span className="c-side-head-tools">
            <NotificationBell variant="side" buttonProps={bind('bell')} />
            <button type="button" className="c-side-icon c-side-toggle" onClick={toggleSide} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} {...bind('toggle')}>
              {collapsed ? <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          </span>
        </div>

        <div className="c-side-top">
          <Link href="/tutor" className="c-btn c-btn--primary c-side-new" aria-label="New chat" aria-current={current === 'new' ? 'page' : undefined} onClick={newChat} {...tipFor('new')}>
            <SquarePen size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">New chat</span>
          </Link>
          <button type="button" className="c-side-item c-side-search" onClick={() => setSearch({ instant: false })} aria-label={`Search (${shortcut})`} aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'} {...tipFor('search')}>
            <Search size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-side-label">Search</span><kbd className="c-side-kbd" aria-hidden="true">{shortcut}</kbd>
          </button>
        </div>

        <nav className="c-side-nav" aria-label="Classes and chats" onScroll={hide}>
          <div className="c-side-section" role="group" aria-labelledby="c-side-classes">
            <div className="c-side-heading-row">
              <h2 id="c-side-classes" className="c-side-heading">Classes</h2>
              <Link className="c-side-add" href="/library?add=class" aria-label="Add a class" {...bind('add')}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
            {shownClasses.length > 0 && (
              <ul className="c-side-list">
                {shownClasses.map(item => {
                  const ready = readiness[item.id];
                  return (
                    <li key={item.id}>
                      <Link className="c-side-item c-side-class" href={`/folder/${item.id}`} aria-current={current === 'class:' + item.id ? 'page' : undefined}
                        aria-label={[item.code === item.name ? item.name : `${item.code}, ${item.name}`, ready && `${ready.percent}% ready for the next exam`].filter(Boolean).join(', ')}
                        {...tipFor('class:' + item.id)}>
                        <span className="c-side-dot" style={{ '--dot': `var(--cover-ink-${item.tone})` }} aria-hidden="true" />
                        <span className="c-side-label">{item.code}</span>
                        {ready && (
                          <span className="c-side-ready" aria-hidden="true">
                            <span className="c-side-label">{ready.percent}%</span>
                            <ProgressRing value={ready.percent / 100} size={16} stroke={2.25} label={false} title={`${ready.percent}% ready for the next exam`} />
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {classes && classes.length > 0 && <Link className="c-side-all" href="/library">See all</Link>}
            {classes && classes.length === 0 && <p className="c-side-empty c-side-label">No classes yet</p>}
          </div>

          <div className="c-side-section c-side-chats" role="group" aria-labelledby="c-side-chats">
            <h2 id="c-side-chats" className="c-side-heading c-side-heading-row">Recent chats</h2>
            {chats.length > 0 ? (
              <ul className="c-side-list c-side-chat-list">
                {chats.map(chat => (
                  <li key={chat.key}>
                    <Link className="c-side-item c-side-chat" href={chat.href} onClick={() => openChat(chat)} aria-current={current === chat.key ? 'page' : undefined}>
                      <span className="c-side-label">{chat.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="c-side-empty">Chats with the Tutor show up here.</p>}
          </div>
          {/* Folded, the chats open from one icon, in a menu beside the sidebar. */}
          <button ref={chatsRef} type="button" className="c-side-item c-side-chats-icon" aria-label="Recent chats" aria-haspopup="menu" aria-expanded={chatsOpen}
            aria-current={current.startsWith('chat:') ? 'page' : undefined} {...tipFor('chats')} onClick={() => { hide(); setChatsOpen(open => !open); }}>
            <MessagesSquare size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </nav>

        <div className="c-side-foot">
          <button ref={sideAvatarRef} type="button" className="c-side-item c-side-account" onClick={() => toggleMenu('side')} aria-expanded={menuOpen && menuFrom === 'side'} aria-haspopup="menu"
            aria-current={current === 'account' ? 'page' : undefined} aria-label={`${displayName || 'Account'}, account menu`} {...tipFor('account')}>
            <span className="c-avatar c-side-avatar" aria-hidden="true">{initials || <User size={18} strokeWidth={1.75} />}</span>
            <span className="c-side-label c-side-who"><strong className="c-truncate">{displayName || 'Account'}</strong>{planLine && <span className="c-truncate">{planLine}</span>}</span>
            <Ellipsis className="c-side-dots" size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </aside>
      <ShellTipLayer tip={menuOpen || chatsOpen ? null : tip} items={sideTips} side="right" />
      <ShellMenu open={chatsOpen && folded} onClose={closeChats} anchorRef={chatsRef} side="right" label="Recent chats"
        items={chats.slice(0, 12).map(chat => ({ key: chat.key, label: chat.title, href: chat.href, current: current === chat.key, onSelect: () => openChat(chat) }))} />

      <ToolRail />

      {/* Phones: brand, search and account on top; the tab bar below. */}
      <header className="c-topbar">
        <Link className="c-brand" href="/dashboard" aria-label="Cordia Classroom, Dashboard">
          <AcademicInfinityMark className="top-navigation-mark" title="" />
          <span><BrandName /></span>
        </Link>

        <nav className="c-nav" aria-label="Primary">
          {[...navItems, assistantItem].map(item => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} data-spot={item.spot}>
              <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="c-bar-actions">
          {/* Search is an icon: the ⌘K / Ctrl K shortcut shows on hover. */}
          <button type="button" className="c-btn c-btn--secondary c-searchbtn" onClick={() => setSearch({ instant: false })} aria-label={`Search (${shortcut})`} title={`Search (${shortcut})`} aria-keyshortcuts={shortcut === '⌘K' ? 'Meta+K' : 'Control+K'}>
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <NotificationBell variant="top" />
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

      {search && <SearchModal instant={search.instant} onClose={() => setSearch(null)} />}
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
