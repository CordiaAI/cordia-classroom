import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { CalendarDays, ChartColumn, Compass, Gauge, Globe, GraduationCap, Highlighter, Keyboard, Lightbulb, MessageCircle, Timer, X } from 'lucide-react';

const ICONS = { CalendarDays, ChartColumn, Compass, Gauge, Globe, GraduationCap, Highlighter, Keyboard, MessageCircle, Timer };
import { TIPS, TIP_EVENT, dismissTip, markTipShown, tipSelector } from '../lib/tips';
import { claimSurface, dismissFeature, markAnnounced, releaseSurface } from '../lib/whatsNew';

const WAIT_MS = 4000;
const EDGE = 12;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// Renders the single feature tip, anchored under the element it points at.
export default function TipHost() {
  const router = useRouter();
  const [tip, setTip] = useState(null); // { id, text, rect }
  const timer = useRef(null);
  // The tip's real size, so a long tip is kept fully on screen (it wraps when it must).
  const tipRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useIsoLayoutEffect(() => {
    const node = tipRef.current;
    if (!node) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    if (Math.abs(w - size.w) > 0.5 || Math.abs(h - size.h) > 0.5) setSize({ w, h });
  });

  useEffect(() => {
    function onTip(event) {
      const { id, text } = event.detail || {};
      if (!TIPS[id]) return;
      const started = Date.now();
      clearInterval(timer.current);
          // The anchor can render a moment after the request (data still loading).
      timer.current = setInterval(() => {
        const target = document.querySelector(tipSelector(id));
        if (target && target.getClientRects().length) {
          clearInterval(timer.current);
          // A What's new tip waits its turn: never at the same moment as the Dashboard card.
          const release = TIPS[id].release;
          if (release && !claimSurface('tip')) return;
          if (release) markAnnounced(release);
          markTipShown(id);
          setTip({ id, text: text || TIPS[id].text, rect: target.getBoundingClientRect() });
        } else if (Date.now() - started > WAIT_MS) clearInterval(timer.current);
      }, 150);
    }
    window.addEventListener(TIP_EVENT, onTip);
    return () => { window.removeEventListener(TIP_EVENT, onTip); clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (!tip) return;
    const place = () => {
      const target = document.querySelector(tipSelector(tip.id));
      if (!target) { setTip(null); return; }
      setTip(current => current && { ...current, rect: target.getBoundingClientRect() });
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    // The thing the tip points at can go away without a scroll (a button that hides once used):
    // the tip goes with it.
    const gone = setInterval(() => {
      const target = document.querySelector(tipSelector(tip.id));
      if (!target || !target.getClientRects().length) setTip(null);
    }, 300);
    const leave = () => setTip(null);
    router.events.on('routeChangeStart', leave);
    // Escape dismisses it, like the X.
    const onKey = event => { if (event.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      clearInterval(gone);
      router.events.off('routeChangeStart', leave);
      window.removeEventListener('keydown', onKey);
    };
  }, [tip?.id, router.events]);

  useEffect(() => {
    if (!tip) releaseSurface('tip');
  }, [tip]);

  function close(useIt) {
    if (!tip) return;
    dismissTip(tip.id);
    const release = TIPS[tip.id]?.release;
    // Closing a What's new tip with X or Escape dismisses the feature for good.
    if (release && !useIt) dismissFeature(release);
    const target = document.querySelector(tipSelector(tip.id));
    setTip(null);
    if (useIt && target) target.click?.();
  }

  if (!tip) return null;
  const Icon = ICONS[TIPS[tip.id].icon] || Lightbulb;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = size.w || 220;
  const h = size.h || 44;
  const left = Math.max(EDGE, Math.min(tip.rect.left + tip.rect.width / 2 - w / 2, vw - EDGE - w));
  const below = tip.rect.bottom + 10 + h <= vh - EDGE;
  const top = below ? tip.rect.bottom + 10 : Math.max(EDGE, Math.min(tip.rect.top - 10 - h, vh - EDGE - h));
  const style = { top, left };

  return (
    <div ref={tipRef} className="c-tip" style={style} role="status">
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <button type="button" className="c-tip-text" onClick={() => close(true)}>{tip.text}</button>
      <button type="button" className="c-icon-btn" onClick={() => close(false)} aria-label="Dismiss tip">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <style jsx>{`
        .c-tip-text { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--ink); font:600 15px/1.3 var(--font-sans); text-align: left; overflow-wrap: anywhere; cursor: pointer; padding: 6px 2px; }
        .c-tip :global(.c-icon-btn) { width: 32px; height: 32px; }
      `}</style>
    </div>
  );
}
