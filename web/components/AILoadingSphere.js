import { useId } from 'react';

const LOGO = '/academic-butterfly-open-book.png';
// Centerline of the Cordia infinity stroke in the logo's 512×323 space: left hook → top-left
// lobe → crossover → right lobe → back through the crossover → lower-left tail.
const TRACE = [
  [95, 240], [50, 175], [22, 119], [50, 74], [80, 66], [110, 79], [170, 117], [230, 160], [275, 190],
  [320, 221], [380, 248], [410, 250], [440, 226], [470, 149], [445, 96], [410, 98], [350, 132],
  [320, 153], [275, 190], [230, 223], [170, 275], [135, 297],
];
const DURATION = 4.2;
const BUBBLES = [0, 0.17, 0.34, 0.51, 0.68, 0.85];

// Catmull-Rom through the traced points gives a smooth path for the bubbles to ride.
function smoothPath(points) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [points[i - 1] || points[i], points[i], points[i + 1], points[i + 2] || points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
const PATH = smoothPath(TRACE);

// Loading state: liquid bubbles of "matter" ride the Cordia mark, swelling out of the
// stroke and merging back in (gooey filter), while a light wave travels through it.
export default function AILoadingSphere({ size = 100, label = 'Loading...' }) {
  const id = useId().replace(/:/g, '');
  const width = Math.round(size * 3.4);

  return (
    <div className="cordia-loader" role="status" aria-live="polite">
      <svg viewBox="-30 -30 572 383" width={width} height={Math.round(width * 383 / 572)} aria-hidden="true">
        <defs>
          <path id={`${id}-trace`} d={PATH} pathLength="1000" />
          <filter id={`${id}-ink`} colorInterpolationFilters="sRGB">
            <feColorMatrix values="0 0 0 0 0.067  0 0 0 0 0.07  0 0 0 0 0.059  0 0 0 1 0" />
          </filter>
          <filter id={`${id}-white`} colorInterpolationFilters="sRGB">
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
          </filter>
          <filter id={`${id}-goo`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
          </filter>
          <mask id={`${id}-inside`} maskUnits="userSpaceOnUse" x="-30" y="-30" width="572" height="383">
            <image href={LOGO} width="512" height="323" filter={`url(#${id}-white)`} />
          </mask>
          <linearGradient id={`${id}-glow`} x1="0" x2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Liquid layer: a softened copy of the mark plus the travelling bubbles, fused together. */}
        <g filter={`url(#${id}-goo)`}>
          <image href={LOGO} width="512" height="323" filter={`url(#${id}-ink)`} />
          {BUBBLES.map((offset, index) => (
            <circle key={offset} r="0" fill="#11120f">
              <animateMotion dur={`${DURATION}s`} repeatCount="indefinite" begin={`-${(offset * DURATION).toFixed(2)}s`}>
                <mpath href={`#${id}-trace`} />
              </animateMotion>
              <animate
                attributeName="r"
                dur={`${DURATION}s`}
                begin={`-${(offset * DURATION).toFixed(2)}s`}
                repeatCount="indefinite"
                values={index % 2 ? '0;30;18;34;20;28;0' : '0;24;36;20;32;22;0'}
              />
            </circle>
          ))}
        </g>

        {/* Crisp mark on top keeps the logo's exact edges and the open book. */}
        <image href={LOGO} width="512" height="323" filter={`url(#${id}-ink)`} />

        {/* Light wave travelling through the inside of the stroke. */}
        <g mask={`url(#${id}-inside)`}>
          <use href={`#${id}-trace`} className="cordia-loader-wave" stroke={`url(#${id}-glow)`}>
            <animate attributeName="stroke-dashoffset" from="110" to="-890" dur={`${DURATION}s`} repeatCount="indefinite" />
          </use>
        </g>
      </svg>
      <p>{label}</p>

      <style jsx>{`
        .cordia-loader { display: grid; justify-items: center; gap: 22px; }
        .cordia-loader svg { overflow: visible; filter: drop-shadow(0 18px 26px rgba(17, 18, 15, 0.2)); }
        .cordia-loader :global(.cordia-loader-wave) {
          fill: none; stroke-width: 40; stroke-linecap: round; opacity: 0.55;
          stroke-dasharray: 110 890;
        }
        .cordia-loader p {
          margin: 0; color: #11120f; font-family: var(--font-sans); font-size: 1.05rem;
          font-weight: 650; letter-spacing: -0.02em; animation: cordia-breathe 1.8s ease-in-out infinite;
        }
        @keyframes cordia-breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .cordia-loader p { animation: none; }
        }
      `}</style>
    </div>
  );
}
