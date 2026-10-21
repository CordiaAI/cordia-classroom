import { ShotStyle } from './CanvasShots';

// Drawn copy of the browser screen for turning the microphone back on: the site-settings
// icon left of the address is circled, and its menu shows Microphone set to Allow.
const TEXT = { fontFamily: 'Quicksand, Arial, sans-serif', fontWeight: 600 };

export default function MicHelp() {
  return (
    <svg viewBox="0 0 400 200" role="img" aria-label="Browser address bar with the site settings icon circled and Microphone set to Allow" className="canvas-shot mic-help">
      <rect x="1" y="1" width="398" height="198" rx="14" className="shot-frame shot-edge" />
      <path d="M1 15a14 14 0 0 1 14-14h370a14 14 0 0 1 14 14v21H1z" className="shot-chrome" />
      {[16, 30, 44].map(x => <circle key={x} cx={x} cy="18" r="4.5" className="shot-line-fill" />)}
      <rect x="62" y="9" width="250" height="18" rx="9" className="shot-frame" />
      {/* site settings icon (two sliders) */}
      <g transform="translate(70 12)" className="shot-text">
        <path d="M1 4h10M1 9h10" stroke="currentColor" strokeWidth="1.4" style={{ stroke: 'var(--shot-text)' }} />
        <circle cx="4" cy="4" r="1.8" style={{ fill: 'var(--shot-frame)', stroke: 'var(--shot-text)' }} strokeWidth="1.2" />
        <circle cx="8" cy="9" r="1.8" style={{ fill: 'var(--shot-frame)', stroke: 'var(--shot-text)' }} strokeWidth="1.2" />
      </g>
      <text x="90" y="22" fontSize="11" style={TEXT} className="shot-text">classroom.cordiaai.io</text>
      <ellipse cx="76" cy="18" rx="16" ry="13" fill="none" className="shot-mark" strokeWidth="4" />
      {/* the menu that opens */}
      <rect x="60" y="44" width="220" height="132" rx="12" className="shot-frame shot-edge" />
      <text x="76" y="68" fontSize="12" style={TEXT} className="shot-text">Site settings</text>
      <rect x="76" y="80" width="188" height="1" className="shot-line-fill" />
      <text x="76" y="106" fontSize="13" style={TEXT} className="shot-text">Microphone</text>
      <rect x="196" y="92" width="60" height="24" rx="12" className="shot-soft" />
      <text x="226" y="108" fontSize="11" textAnchor="middle" style={TEXT} className="shot-link">Allow</text>
      <ellipse cx="226" cy="104" rx="40" ry="18" fill="none" className="shot-mark" strokeWidth="4" />
      <text x="76" y="146" fontSize="12" style={TEXT} className="shot-text">Camera</text>
      <rect x="196" y="133" width="60" height="20" rx="10" className="shot-soft" />
      <ShotStyle />
    </svg>
  );
}
