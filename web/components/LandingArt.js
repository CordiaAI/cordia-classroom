import { Check, Mic } from 'lucide-react';

// Decoration behind the sign-in headline: a lecture going in (01) and what comes out (02), drawn
// as quiet UI pieces on a soft glow. Hidden from screen readers; hidden on narrow screens.
export default function LandingArt() {
  return (
    <div className="art" aria-hidden="true">
      <div className="art-glow" />

      <div className="art-steps">
        <span className="art-num">02</span>
        <span className="art-heading">What you get</span>
        {['Notes, outlined', 'Cards to flip', 'A quiz to check yourself'].map((label, index) => (
          <span key={label} className="art-row" style={{ '--i': index }}>
            <Check size={14} strokeWidth={1.75} />{label}
          </span>
        ))}
      </div>

      <div className="art-card">
        <span className="art-num">01</span>
        <div className="art-seg"><span className="is-on">Record</span><span>Upload</span><span>Paste</span></div>
        <div className="art-field">
          <Mic size={14} strokeWidth={1.75} />
          <span className="art-wave">{[6, 11, 16, 9, 14, 7, 12, 17, 8, 13, 6, 10, 15, 7, 12, 9, 16, 6].map((h, index) => <i key={index} style={{ height: h, '--i': index }} />)}</span>
          <span className="art-time">48:12</span>
        </div>
        <div className="art-btn">Make my guide</div>
      </div>

      <div className="art-rule" />

      <style jsx>{`
        .art { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
        .art-glow { position: absolute; left: 20%; top: 50%; width: 640px; height: 640px; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(closest-side, var(--olive-tint), transparent); animation: art-glow 9s var(--ease) infinite alternate; }

        .art-num { font: 500 11px/1 var(--font-mono); letter-spacing: 0.04em; color: var(--olive-ink); }

        .art-steps { position: absolute; top: 6%; left: 0; width: 240px; display: grid; gap: 0; }
        .art-heading { margin: 8px 0 10px; font: 400 21px/1.2 var(--font-display); color: var(--ink); }
        .art-row { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); font: 400 13px/1.2 var(--font-sans); color: var(--muted-ink); opacity: 0; animation: art-in 600ms var(--ease) forwards; animation-delay: calc(900ms + var(--i) * 260ms); }
        .art-row :global(svg) { color: var(--olive); flex: none; }

        .art-card { position: absolute; top: 2%; right: 4%; width: 264px; display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: var(--shadow-card); opacity: 0; animation: art-in 700ms var(--ease) 200ms forwards; }
        .art-seg { display: flex; gap: 4px; font: 500 11px/1 var(--font-sans); color: var(--muted-ink); }
        .art-seg span { padding: 5px 9px; border-radius: 999px; }
        .art-seg .is-on { background: var(--olive-tint); color: var(--olive-ink); }
        .art-field { display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; color: var(--olive); }
        .art-wave { display: flex; align-items: center; gap: 3px; flex: 1; height: 18px; }
        .art-wave i { display: block; width: 2px; border-radius: 1px; background: var(--olive); opacity: 0.8; transform-origin: center; animation: art-wave 1.6s ease-in-out infinite alternate; animation-delay: calc(var(--i) * -110ms); }
        .art-time { font: 500 12px/1 var(--font-mono); color: var(--muted-ink); }
        .art-btn { display: grid; place-items: center; height: 34px; border-radius: 999px; background: var(--olive); color: var(--on-olive); font: 600 12px/1 var(--font-sans); }

        .art-rule { position: absolute; left: 0; right: 4%; bottom: 10%; height: 1px; background: var(--line); }

        @keyframes art-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes art-glow { from { transform: translate(-50%, -50%) scale(0.94); } to { transform: translate(-46%, -52%) scale(1.04); } }
        @keyframes art-wave { from { transform: scaleY(0.45); } to { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) {
          .art-glow, .art-wave i { animation: none; }
          .art-row, .art-card { animation: none; opacity: 1; }
        }
        @media (max-width: 1100px) { .art-steps { display: none; } }
        @media (max-width: 860px) { .art { display: none; } }
      `}</style>
    </div>
  );
}
