import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import BodyPortal from './BodyPortal';

const BUBBLE = 44;
const GAP = 8;
const SIGN_OUT_EXTRA = 8;

// The account menu: one glass bubble per item, folding out from under the avatar.
// Open: bubbles start stacked behind the first one and slide down in order (40 ms stagger,
// 260 ms each, ~3 px overshoot). Close: last bubble first, back up behind the one above
// (30 ms stagger, 200 ms, ease-in). Rendered on <body> so the top bar's blur can't make
// the bubbles see-through.
// items: [{ key, label, icon, onSelect, separated }]
export default function AccountMenu({ open, onClose, anchorRef, items, placement = 'below' }) {
  // below: right-aligned under a top-bar avatar. above: beside the sidebar's account row, folding up
  // from it.
  const above = placement === 'above';
  const [phase, setPhase] = useState(open ? 'opening' : 'closed'); // opening | open | closing | closed
  const [anchor, setAnchor] = useState(null);
  const listRef = useRef(null);
  const timer = useRef(null);
  const count = items.length;

  // Open and close drive the phases; closing waits for the last bubble to fold in.
  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setPhase('opening');
      timer.current = setTimeout(() => setPhase('open'), 260 + 40 * (count - 1) + 20);
    } else {
      setPhase(current => {
        if (current === 'closed') return current;
        timer.current = setTimeout(() => setPhase('closed'), reducedMotion() ? 160 : 200 + 30 * (count - 1) + 20);
        return 'closing';
      });
    }
    return () => clearTimeout(timer.current);
  }, [open, count]);

  // Sit right-aligned under the avatar.
  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      const rect = anchorRef.current?.getBoundingClientRect();
      // Above: beside the sidebar, bottom edge on the account row's, so it covers none of the sidebar.
      const side = anchorRef.current?.closest('.c-side')?.getBoundingClientRect();
      if (rect) setAnchor(above ? { bottom: Math.max(8, window.innerHeight - rect.bottom), left: (side?.right ?? rect.right) + GAP } : { top: rect.bottom + GAP, right: Math.max(8, window.innerWidth - rect.right) });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchorRef, above]);

  // First bubble takes focus; Escape and outside clicks close; focus goes back to the avatar.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => listRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(true); }
    }
    function onPointer(event) {
      if (listRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      onClose(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, anchorRef]);

  function onKeyDown(event) {
    const buttons = [...listRef.current.querySelectorAll('[role="menuitem"]')];
    const index = buttons.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (move) { event.preventDefault(); buttons[(index + move + buttons.length) % buttons.length]?.focus(); }
    if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); }
    if (event.key === 'End') { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    if (event.key === 'Tab') onClose(false);
  }

  if (phase === 'closed' || !anchor) return null;

  // Each bubble's distance from the first one's spot (where they all start, stacked).
  // Folding up, they start stacked behind the last one (nearest the account row) instead.
  let offset = 0;
  const offsets = items.map((item, index) => {
    if (index > 0) offset += BUBBLE + GAP + (item.separated ? SIGN_OUT_EXTRA : 0);
    return offset;
  });
  const span = offsets[offsets.length - 1] || 0;

  return (
    <BodyPortal>
      <div
        ref={listRef}
        className={`acct-bubbles is-${phase}`}
        role="menu"
        aria-label="Account"
        style={above ? { bottom: anchor.bottom, left: anchor.left } : { top: anchor.top, right: anchor.right }}
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={'acct-bubble' + (item.separated ? ' is-separated' : '')}
            style={{
              '--from': above ? `${span - offsets[index]}px` : `${-offsets[index]}px`,
              '--open-delay': `${(above ? count - 1 - index : index) * 40}ms`,
              '--close-delay': `${(above ? index : count - 1 - index) * 30}ms`,
              zIndex: above ? index + 1 : count - index,
            }}
            onClick={() => { onClose(true); item.onSelect(); }}
          >
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      <style jsx global>{`
        /* One column: every bubble as wide as the longest label (min 200px), right edge on the avatar's. */
        .acct-bubbles { position: fixed; z-index: 160; display: grid; grid-template-columns: minmax(200px, max-content); gap: ${GAP}px; pointer-events: none; }
        .acct-bubbles.is-open, .acct-bubbles.is-opening { pointer-events: auto; }
        .acct-bubble {
          position: relative; display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%;
          height: ${BUBBLE}px; padding: 0 20px 0 16px; border-radius: 999px; text-align: left;
          background: var(--lg-menu); border: 1px solid var(--lg-edge);
          -webkit-backdrop-filter: var(--lg-filter); backdrop-filter: var(--lg-filter);
          box-shadow: var(--lg-highlight), var(--lg-shadow);
          color: var(--ink); font: 500 15px/1 var(--font-sans); white-space: nowrap; cursor: pointer;
          /* No background transition: the fill is gradient layers, which can't animate, so a transition
             to a plain color left the bubble see-through (a grey flash) for a moment on hover. */
          transition: border-color 160ms ease-out, transform 160ms ease-out, box-shadow 160ms ease-out;
        }
        .acct-bubble .lucide { flex: 0 0 auto; width: 20px; height: 20px; color: var(--ink); }
        .acct-bubble.is-separated { margin-top: ${SIGN_OUT_EXTRA}px; }
        .acct-bubble:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .acct-bubble:active { transform: scale(.98); }
        @media (hover: hover) {
          .acct-bubbles.is-open .acct-bubble:hover, .acct-bubbles.is-open .acct-bubble:focus-visible {
            --acct-hover: color-mix(in srgb, var(--lg-fill-menu), var(--hover-light) 6%);
            background: var(--lg-sheen), linear-gradient(var(--acct-hover), var(--acct-hover));
            border-color: var(--hover-edge);
            transform: translateY(-1px);
          }
          .acct-bubbles.is-open .acct-bubble:active { transform: translateY(-1px) scale(.98); }
        }
        .acct-bubbles.is-opening .acct-bubble { animation: acct-fold-out 260ms ease-out var(--open-delay) both; }
        .acct-bubbles.is-closing .acct-bubble { animation: acct-fold-in 200ms ease-in var(--close-delay) both; }
        @keyframes acct-fold-out {
          0% { transform: translateY(var(--from)) scale(.9); opacity: 0; }
          72% { transform: translateY(3px) scale(1); opacity: 1; }
          100% { transform: none; opacity: 1; }
        }
        @keyframes acct-fold-in {
          from { transform: none; opacity: 1; }
          to { transform: translateY(var(--from)) scale(.9); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .acct-bubbles.is-opening .acct-bubble { animation: acct-fade-in 150ms ease-out both; }
          .acct-bubbles.is-closing .acct-bubble { animation: acct-fade-out 150ms ease-in both; }
          .acct-bubble:hover, .acct-bubble:active { transform: none !important; }
        }
        @keyframes acct-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes acct-fade-out { from { opacity: 1; } to { opacity: 0; } }
      `}</style>
    </BodyPortal>
  );
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
