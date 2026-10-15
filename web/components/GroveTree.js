// An olive tree that grows with study minutes: Seed, Sprout, Sapling, Tree, Olive tree.
// Flat olive-palette shapes; olive leaves are long and narrow, set in pairs.
export const STAGES = [
  { name: 'Seed', minutes: 0 },
  { name: 'Sprout', minutes: 10 },
  { name: 'Sapling', minutes: 30 },
  { name: 'Tree', minutes: 60 },
  { name: 'Olive tree', minutes: 120 },
];

export function groveStage(minutes = 0) {
  let stage = 0;
  STAGES.forEach((item, index) => { if (minutes >= item.minutes) stage = index; });
  return stage;
}

// "12 min to Tree" for the next stage, or '' when fully grown.
export function nextStageLabel(minutes = 0) {
  const next = STAGES[groveStage(minutes) + 1];
  return next ? `${Math.max(1, Math.ceil(next.minutes - minutes))} min to ${next.name}` : '';
}

const LEAF = 'var(--olive)';
const TRUNK = 'var(--olive-press)';

function Leaf({ x, y, angle, length = 9, opacity = 1 }) {
  return <ellipse cx={x} cy={y} rx={length} ry={length * 0.28} fill={LEAF} opacity={opacity} transform={`rotate(${angle} ${x} ${y})`} />;
}

// Leaf pairs along a branch from (x1,y1) to (x2,y2).
function Branch({ x1, y1, x2, y2, width = 2, leaves = 3, length = 8 }) {
  const items = [];
  for (let i = 1; i <= leaves; i += 1) {
    const t = i / (leaves + 0.4);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const base = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    items.push(<Leaf key={`a${i}`} x={x - 3} y={y - 3} angle={base - 40} length={length} opacity={0.92} />);
    items.push(<Leaf key={`b${i}`} x={x + 3} y={y - 2} angle={base + 40} length={length} opacity={0.78} />);
  }
  return <g><path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={TRUNK} strokeWidth={width} strokeLinecap="round" />{items}</g>;
}

function Stage({ stage }) {
  if (stage === 0) {
    return <>
      <ellipse cx="50" cy="82" rx="6" ry="4" fill={TRUNK} />
      <path d="M50 79 q1 -3 3 -4" stroke={LEAF} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>;
  }
  if (stage === 1) {
    return <>
      <path d="M50 84 C50 76 49 70 50 64" stroke={TRUNK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Leaf x={44} y={63} angle={-30} length={7} />
      <Leaf x={56} y={62} angle={30} length={7} opacity={0.8} />
    </>;
  }
  if (stage === 2) {
    return <>
      <path d="M50 84 C50 72 49 60 50 46" stroke={TRUNK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Branch x1={50} y1={66} x2={36} y2={56} leaves={2} />
      <Branch x1={50} y1={60} x2={63} y2={50} leaves={2} />
      <Leaf x={46} y={46} angle={-60} length={7} />
      <Leaf x={54} y={45} angle={60} length={7} opacity={0.8} />
    </>;
  }
  const full = stage === 4;
  return <>
    <path d={`M47 84 C49 74 46 64 50 ${full ? 50 : 54} M50 66 C54 62 56 60 58 57`} stroke={TRUNK} strokeWidth={full ? 4.5 : 3.6} fill="none" strokeLinecap="round" />
    <Branch x1={50} y1={56} x2={28} y2={40} width={2} leaves={3} length={9} />
    <Branch x1={50} y1={54} x2={72} y2={38} width={2} leaves={3} length={9} />
    <Branch x1={50} y1={52} x2={46} y2={22} width={2} leaves={3} length={9} />
    <Branch x1={52} y1={60} x2={76} y2={56} width={1.6} leaves={2} length={8} />
    <Branch x1={48} y1={60} x2={24} y2={58} width={1.6} leaves={2} length={8} />
    {full && [[33, 44], [66, 40], [44, 30], [70, 55], [28, 58], [55, 26]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" fill={TRUNK} />)}
  </>;
}

export default function GroveTree({ minutes = 0, size = 96, title, grow = false }) {
  const stage = groveStage(minutes);
  return (
    <svg className={'grove-tree' + (grow ? ' is-growing' : '')} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title || `${STAGES[stage].name}, ${Math.round(minutes)} minutes`}>
      <path d="M20 85 Q50 81 80 85" stroke="var(--line)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <Stage stage={stage} />
      <style jsx>{`
        .grove-tree { display: block; overflow: visible; }
        .grove-tree.is-growing { transform-origin: 50% 85%; animation: tree-grow 220ms cubic-bezier(.2, .8, .2, 1) both; }
        @keyframes tree-grow { from { transform: scale(.92); opacity: .4; } to { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .grove-tree.is-growing { animation: none; } }
      `}</style>
    </svg>
  );
}
