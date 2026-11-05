import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Bell } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { loadNotifications, loadSocialSummary, markNotificationsRead, notificationHref, notificationText, onSocialSummary } from '../lib/social';

const EDGE = 8;

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

// The bell with the unread count. variant 'side': a sidebar item (wide screens); 'top': an icon
// button in the phone top bar. Opening the panel shows the latest and marks them read.
export default function NotificationBell({ variant = 'top', tip }) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [place, setPlace] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => onSocialSummary(summary => setUnread(summary?.unread_notifications || 0)), []);
  useEffect(() => { loadSocialSummary().then(summary => setUnread(summary?.unread_notifications || 0)); }, [router.pathname]);
  useEffect(() => { setOpen(false); }, [router.asPath]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setItems(null);
    loadNotifications().then(data => {
      if (!active) return;
      setItems(data ? data.items : []);
      if (data?.items.some(item => !item.read)) markNotificationsRead();
    });
    const onDown = event => {
      if (!panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = event => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { active = false; document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - EDGE * 2);
    const left = variant === 'side' ? anchor.right + 12 : anchor.right - width;
    setPlace({ top: variant === 'side' ? anchor.top : anchor.bottom + 8, left: Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE), width });
  }, [open, variant]);

  useEffect(() => { if (open && items) panelRef.current?.querySelector('a')?.focus(); }, [open, items]);

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  const badge = unread ? <span className="nb-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span> : null;

  return (
    <>
      {variant === 'side' ? (
        <button ref={buttonRef} type="button" className="c-side-item nb-side" aria-label={label} aria-expanded={open} aria-haspopup="dialog" title={tip ? tip('Notifications') : undefined} onClick={() => setOpen(value => !value)}>
          <span className="nb-icon"><Bell size={20} strokeWidth={1.75} aria-hidden="true" />{badge}</span>
          <span className="c-side-label">Notifications</span>
        </button>
      ) : (
        <button ref={buttonRef} type="button" className="c-btn c-btn--secondary c-searchbtn nb-top" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
          <Bell size={20} strokeWidth={1.75} aria-hidden="true" />{badge}
        </button>
      )}
      {open && (
        <BodyPortal>
          <div ref={panelRef} className="c-menu is-floating nb-panel" role="dialog" aria-label="Notifications"
            style={place ? { top: place.top, left: place.left, width: place.width } : { top: -9999, left: -9999 }}>
            <h2 className="c-section-title nb-title">Notifications</h2>
            {items === null && <SectionLoader height={96} label="Loading notifications" />}
            {items && items.length === 0 && <p className="c-meta nb-empty">No notifications yet.</p>}
            {items && items.length > 0 && (
              <ul className="nb-list">
                {items.map(item => (
                  <li key={item.id}>
                    <Link href={notificationHref(item)} className={'nb-item' + (item.read ? '' : ' is-new')}>
                      <span className="nb-avatar" aria-hidden="true">{item.actor.initials}</span>
                      <span className="nb-text"><strong>{item.actor.display_name}</strong> {notificationText(item.kind)}</span>
                      <span className="c-meta nb-time">{ago(item.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/friends" className="nb-all">Friends and requests</Link>
          </div>
        </BodyPortal>
      )}
      <style jsx global>{`
        .nb-icon { position: relative; display: inline-flex; }
        .nb-top { position: relative; }
        .nb-badge { position: absolute; top: -6px; right: -8px; display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--olive); color: var(--on-olive); font: 700 11px/1 var(--font-sans); }
        .nb-top .nb-badge { top: 2px; right: 2px; }
        .nb-panel { position: fixed; z-index: 170; display: grid; gap: 8px; padding: 12px; max-height: min(480px, calc(100vh - 96px)); overflow-y: auto; }
        .nb-title { margin: 4px 8px 0; }
        .nb-empty { margin: 8px; }
        .nb-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
        .nb-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px; border-radius: var(--r-input); color: var(--ink); text-decoration: none; font: 500 15px/1.35 var(--font-sans); }
        .nb-item:hover, .nb-item:focus-visible { background: var(--lift-pane); text-decoration: none; }
        .nb-item.is-new .nb-text strong::after { content: ''; display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%; background: var(--olive); vertical-align: middle; }
        .nb-avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); }
        .nb-text { overflow-wrap: anywhere; }
        .nb-time { white-space: nowrap; }
        .nb-all { justify-self: start; margin: 4px 8px; color: var(--olive-ink); font: 600 15px/1 var(--font-sans); }
      `}</style>
    </>
  );
}
