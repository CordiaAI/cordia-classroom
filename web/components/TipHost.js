import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { CalendarDays, ChartColumn, Lightbulb, MessageCircle, X } from 'lucide-react';

const ICONS = { CalendarDays, ChartColumn, MessageCircle };
import { TIPS, TIP_EVENT, dismissTip, markTipShown } from '../lib/tips';

const WAIT_MS = 4000;

// Renders the single feature tip, anchored under the element it points at.
export default function TipHost() {
  const router = useRouter();
  const [tip, setTip] = useState(null); // { id, text, rect }
  const timer = useRef(null);

  useEffect(() => {
    function onTip(event) {
      const { id, text } = event.detail || {};
      if (!TIPS[id]) return;
      const started = Date.now();
      clearInterval(timer.current);
          // The anchor can render a moment after the request (data still loading).
      timer.current = setInterval(() => {
        const target = document.querySelector(`[data-tip="${id}"]`);
        if (target && target.getClientRects().length) {
          clearInterval(timer.current);
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
      const target = document.querySelector(`[data-tip="${tip.id}"]`);
      if (!target) { setTip(null); return; }
      setTip(current => current && { ...current, rect: target.getBoundingClientRect() });
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const leave = () => setTip(null);
    router.events.on('routeChangeStart', leave);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      router.events.off('routeChangeStart', leave);
    };
  }, [tip?.id, router.events]);

  if (!tip) return null;
  const Icon = ICONS[TIPS[tip.id].icon] || Lightbulb;
  const below = tip.rect.bottom + 64 < window.innerHeight;
  const left = Math.max(12, Math.min(tip.rect.left + tip.rect.width / 2 - 100, window.innerWidth - 232));
  const style = below ? { top: tip.rect.bottom + 10, left } : { top: Math.max(12, tip.rect.top - 54), left };

  function close(useIt) {
    dismissTip(tip.id);
    const target = document.querySelector(`[data-tip="${tip.id}"]`);
    setTip(null);
    if (useIt && target) target.click?.();
  }

  return (
    <div className="c-tip" style={style} role="status">
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <button type="button" className="c-tip-text" onClick={() => close(true)}>{tip.text}</button>
      <button type="button" className="c-icon-btn" onClick={() => close(false)} aria-label="Dismiss tip">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <style jsx>{`
        .c-tip-text { border: 0; background: transparent; color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; padding: 0 2px; }
        .c-tip :global(.c-icon-btn) { width: 32px; height: 32px; }
      `}</style>
    </div>
  );
}
