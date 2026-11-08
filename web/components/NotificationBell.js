import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Bell, Copy, ShieldAlert } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { loadNotifications, loadSocialSummary, markNotificationsRead, notificationHref, notificationText, onSocialSummary } from '../lib/social';
import { whatsNewList } from '../lib/featureReleases';
import { markAnnounced, useWhatsNew } from '../lib/whatsNew';
import { openRelease } from './WhatsNew';
import { WhatsNewList } from './WhatsNewList';
import MergeSheet from './MergeSheet';
import { markPairsSeen, unseenPairs, useDuplicates } from '../lib/duplicates';

const EDGE = 8;

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

// The bell with the unread count. variant 'side': a sidebar item (wide screens); 'top': an icon
// button in the phone top bar. Opening the panel shows What's new (new features, components/
// WhatsNewList.js) and the latest notifications, and marks both seen. The count is unread
// notifications plus new features not shown yet.
export default function NotificationBell({ variant = 'top', tip }) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [place, setPlace] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const whatsNew = useWhatsNew();
  const features = whatsNew.ready ? whatsNewList(whatsNew.releases, whatsNew.user, whatsNew.seen, whatsNew.flags) : [];
  const newFeatures = features.filter(item => item.isNew).map(item => item.id);
  // The dots stay for this look at the panel; opening it counts as showing them.
  const [shownNew, setShownNew] = useState([]);
  // Sets that look like the same material (lib/duplicates.js); Review opens the merge sheet.
  const duplicates = useDuplicates();
  const newPairs = unseenPairs(duplicates.pairs);
  const [merging, setMerging] = useState(null);

  useEffect(() => onSocialSummary(summary => setUnread(summary?.unread_notifications || 0)), []);
  useEffect(() => { loadSocialSummary().then(summary => setUnread(summary?.unread_notifications || 0)); }, [router.pathname]);
  useEffect(() => { setOpen(false); }, [router.asPath]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setItems(null);
    setShownNew(newFeatures);
    if (newFeatures.length) markAnnounced(newFeatures);
    if (duplicates.pairs.length) markPairsSeen(duplicates.pairs);
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

  useEffect(() => { if (open && items) panelRef.current?.querySelector('a, button')?.focus(); }, [open, items]);

  async function showFeature(release) {
    setOpen(false);
    await openRelease(router, release);
  }

  const count = unread + newFeatures.length + newPairs.length;
  const label = count ? `Notifications, ${count} new` : 'Notifications';
  const badge = count ? <span className="nb-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span> : null;
  const featureItems = features.map(item => ({ ...item, isNew: shownNew.includes(item.id) }));

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
            {duplicates.pairs.length > 0 && (
              <section className="nb-dups" aria-labelledby="nb-dups-title">
                <h3 id="nb-dups-title" className="nb-sub">Possible duplicates</h3>
                <ul className="nb-list">
                  {duplicates.pairs.map(pair => (
                    <li key={pair.keep.id + pair.merge.id} className="nb-dup">
                      <span className="nb-avatar" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
                      <span className="nb-text"><strong>{pair.keep.title}</strong> and <strong>{pair.merge.title}</strong> look like the same material</span>
                      <button type="button" className="nb-review" onClick={() => { setOpen(false); setMerging(pair); }}
                        aria-label={`Review ${pair.keep.title} and ${pair.merge.title}`}>Review</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <WhatsNewList items={featureItems} onShow={showFeature} />
            {(featureItems.length > 0 || duplicates.pairs.length > 0) && items !== null && items.length > 0 && <h3 className="nb-sub">Activity</h3>}
            {items === null && <SectionLoader height={96} label="Loading notifications" />}
            {items && items.length === 0 && !featureItems.length && !duplicates.pairs.length && <p className="c-meta nb-empty">No notifications yet.</p>}
            {items && items.length > 0 && (
              <ul className="nb-list">
                {items.map(item => (
                  <li key={item.id}>
                    <Link href={notificationHref(item)} className={'nb-item' + (item.read ? '' : ' is-new')}>
                      {item.actor ? (
                        <>
                          <span className="nb-avatar" aria-hidden="true">{item.actor.initials}</span>
                          <span className="nb-text"><strong>{item.actor.display_name}</strong> {notificationText(item.kind, item)}</span>
                        </>
                      ) : (
                        <>
                          <span className="nb-avatar" aria-hidden="true"><ShieldAlert size={16} strokeWidth={1.75} /></span>
                          <span className="nb-text">{notificationText(item.kind, item)}</span>
                        </>
                      )}
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
      {merging && <MergeSheet pair={merging} onClose={() => setMerging(null)} />}
      <style jsx global>{`
        .nb-icon { position: relative; display: inline-flex; }
        .nb-top { position: relative; }
        .nb-badge { position: absolute; top: -6px; right: -8px; display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--olive); color: var(--on-olive); font: 700 11px/1 var(--font-sans); }
        .nb-top .nb-badge { top: 2px; right: 2px; }
        .nb-panel { position: fixed; z-index: 170; display: grid; gap: 8px; padding: 12px; max-height: min(480px, calc(100vh - 96px)); overflow-y: auto; }
        .nb-title { margin: 4px 8px 0; }
        .nb-empty { margin: 8px; }
        .nb-dup { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px; border-radius: var(--r-input); color: var(--ink); font: 500 15px/1.35 var(--font-sans); }
        .nb-review { min-height: 32px; padding: 0 2px; border: 0; background: none; color: var(--olive-ink); font: 600 14px/1 var(--font-sans); cursor: pointer; }
        .nb-review:hover { text-decoration: underline; }
        .nb-sub { margin: 8px 8px 2px; font: 600 13px/1.3 var(--font-sans); color: var(--muted-ink); }
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
