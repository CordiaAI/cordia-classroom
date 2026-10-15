// An olive tree that grows with study minutes. Calm, flat shapes in the olive palette.
export function groveStage(minutes = 0) {
  if (minutes < 5) return 0;
  if (minutes < 20) return 1;
  if (minutes < 60) return 2;
  if (minutes < 150) return 3;
  return 4;
}

const LEAF = 'var(--olive)';
const TRUNK = 'var(--olive-press)';

function Canopy({ stage }) {
  if (stage === 0) {
    return <>
      <path d="M50 78 C50 70 50 66 50 62" stroke={TRUNK} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <ellipse cx="44" cy="62" rx="6" ry="3" fill={LEAF} transform="rotate(-25 44 62)" />
      <ellipse cx="56" cy="60" rx="6" ry="3" fill={LEAF} opacity=".8" transform="rotate(25 56 60)" />
    </>;
  }
  if (stage === 1) {
    return <>
      <path d="M50 80 C50 68 50 58 50 48" stroke={TRUNK} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M50 62 C44 58 40 56 36 56" stroke={TRUNK} strokeWidth="2" strokeLinecap="round" fill="none" />
      {[[50, 46, 0], [38, 54, -30], [58, 54, 30], [44, 50, -15]].map(([x, y, r], i) => <ellipse key={i} cx={x} cy={y} rx="7" ry="3.2" fill={LEAF} opacity={i % 2 ? 0.75 : 1} transform={`rotate(${r} ${x} ${y})`} />)}
    </>;
  }
  const size = stage === 2 ? 16 : stage === 3 ? 22 : 27;
  const top = stage === 2 ? 46 : stage === 3 ? 40 : 36;
  return <>
    <path d={`M48 82 C49 72 47 62 50 ${top + 8} M50 66 C56 62 60 58 64 54`} stroke={TRUNK} strokeWidth={stage === 2 ? 3.5 : 5} strokeLinecap="round" fill="none" />
    <ellipse cx="50" cy={top} rx={size} ry={size * 0.72} fill={LEAF} opacity=".55" />
    <ellipse cx={50 - size * 0.45} cy={top + 3} rx={size * 0.6} ry={size * 0.45} fill={LEAF} opacity=".8" />
    <ellipse cx={50 + size * 0.5} cy={top + 1} rx={size * 0.55} ry={size * 0.42} fill={LEAF} opacity=".9" />
    <ellipse cx="50" cy={top - size * 0.3} rx={size * 0.55} ry={size * 0.4} fill={LEAF} />
    {stage === 4 && [[40, top + 2], [57, top - 4], [62, top + 6], [47, top - 8], [33, top + 6]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.2" fill={TRUNK} />)}
  </>;
}

export default function GroveTree({ minutes = 0, rings = 0, size = 96, newRing = false, title }) {
  const stage = groveStage(minutes);
  const shown = Math.min(rings, 6);
  return (
    <svg className="grove-tree" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title || `Tree, ${Math.round(minutes)} minutes`}>
      {Array.from({ length: shown }, (_, index) => {
        const isNew = newRing && index === shown - 1;
        return <ellipse key={index} className={isNew ? 'grove-ring is-new' : 'grove-ring'} cx="50" cy="84" rx={14 + index * 5} ry={3 + index * 1.1} fill="none" stroke="var(--olive)" strokeOpacity={0.18 + 0.05 * index} strokeWidth="1.2" />;
      })}
      <ellipse cx="50" cy="84" rx="16" ry="3.2" fill="var(--olive)" opacity=".18" />
      <Canopy stage={stage} />
      <style jsx>{`
        .grove-tree { display: block; overflow: visible; }
        .grove-ring.is-new { transform-origin: 50px 84px; animation: ring-in 900ms cubic-bezier(.34, 1.56, .64, 1) both; }
        @keyframes ring-in { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .grove-ring.is-new { animation: none; } }
      `}</style>
    </svg>
  );
}
