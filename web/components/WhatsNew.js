import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Compass, Gauge, Globe, GraduationCap, Sparkles, Timer, X } from 'lucide-react';
import { getProgress } from '../lib/progress';
import { isTipDismissed, registerTip, requestTip } from '../lib/tips';
import { showMe } from '../lib/showMe';
import { lastGuide } from '../lib/userStore';
import { FOCUS_ROUTES, nextAnnouncement, tipForPage, usedOnPage } from '../lib/featureReleases';
import {
  cardShownThisSession, claimSurface, dismissFeature, featureHref, markAnnounced, markCardShown, markOpened, releaseSurface,
  surfaceTaken, useWhatsNew,
} from '../lib/whatsNew';

export const RELEASE_ICONS = { Compass, Gauge, Globe, GraduationCap, Timer };
export const releaseIcon = name => RELEASE_ICONS[name] || Sparkles;

// "Show me": the feature's walkthrough when it has one, else its page.
export async function openRelease(router, release) {
  if (release.showMeId) { await showMe(router, release.showMeId); return; }
  await router.push(featureHref(release, lastGuide()?.id));
}

// In the app shell: visiting a feature's page counts as using it (its Learn Cordia item ticks),
// and the first time a student lands where a new feature lives, a one-time pointer tip shows it.
// Nothing happens on focus-mode study screens beyond counting the visit.
export function WhatsNewWatcher() {
  const router = useRouter();
  const { ready, user, seen, releases, flags } = useWhatsNew();

  useEffect(() => {
    if (!ready || !router.isReady) return;
    const path = router.pathname;
    if (!FOCUS_ROUTES.includes(path) && !getProgress().wt && !surfaceTaken('tip')) {
      const release = tipForPage(releases, path, user, seen, flags);
      const id = release && `new-${release.id}`;
      if (release && !isTipDismissed(id)) {
        registerTip(id, { text: release.title, icon: release.icon, selector: release.where.anchor, release: release.id });
        requestTip(id);
      }
    }
    const used = usedOnPage(releases, path);
    if (used.length) markOpened(used);
  }, [ready, router.isReady, router.pathname]);

  return null;
}

// Top of the Dashboard: one new feature at a time, oldest first, at most one per session. Escape
// is "Not now", which dismisses that feature for good.
export function WhatsNewCard() {
  const router = useRouter();
  const { ready, user, seen, releases, flags } = useWhatsNew();
  const cardRef = useRef(null);
  const shown = cardShownThisSession();
  const next = ready && !getProgress().wt ? nextAnnouncement(releases, user, seen, flags) : null;
  const release = next && (!shown || shown === next.id) ? next : null;

  useEffect(() => {
    if (!release) return undefined;
    if (!claimSurface('card')) return undefined;
    markCardShown(release.id);
    markAnnounced(release.id);
    return () => releaseSurface('card');
  }, [release?.id]);

  if (!release || surfaceTaken('card')) return null;
  const Icon = releaseIcon(release.icon);

  function notNow() {
    dismissFeature(release.id);
    releaseSurface('card');
  }

  async function show() {
    releaseSurface('card');
    await openRelease(router, release);
  }

  return (
    <section ref={cardRef} className="c-card wn-card" aria-labelledby="wn-title" tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); notNow(); } }}>
      <span className="wn-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.75} /></span>
      <div className="wn-main">
        <p className="wn-kicker">New in Cordia</p>
        <h2 id="wn-title" className="wn-title">{release.title}</h2>
        <p className="wn-text">{release.description}</p>
        <div className="wn-actions">
          <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={show}>Show me</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={notNow}>Not now</button>
        </div>
      </div>
      <button type="button" className="c-icon-btn wn-close" onClick={notNow} aria-label={`Dismiss ${release.title}`}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
      <style jsx>{`
        .wn-card { position: relative; display: flex; gap: 14px; align-items: flex-start; padding: 16px 48px 16px 16px; min-width: 0; }
        .wn-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .wn-main { display: grid; gap: 4px; min-width: 0; }
        .wn-kicker { margin: 0; font: 600 13px/1.3 var(--font-sans); color: var(--olive-ink); }
        .wn-title { margin: 0; font: 500 22px/1.2 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
        .wn-text { margin: 0; color: var(--muted-ink); overflow-wrap: anywhere; }
        .wn-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .wn-card :global(.wn-close) { position: absolute; top: 8px; right: 8px; }
        @media (prefers-reduced-motion: no-preference) {
          .wn-card { animation: wn-in var(--dur, 200ms) var(--ease, ease-out); }
          @keyframes wn-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        }
      `}</style>
    </section>
  );
}
