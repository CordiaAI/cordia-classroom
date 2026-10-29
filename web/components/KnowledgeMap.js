import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { prefersReducedMotion, tokenColor } from '../lib/motion';

// Each guide is a cluster on a slowly turning sphere; each of its flashcards is a point, coloured
// by how well it's known. Drawn on one canvas with a small perspective projection (no 3D library).
// Drag to turn it; points light up as cards are learned.
const MAX_GUIDES = 24;
const MAX_CARDS = 48;
const LEVELS = [
  { key: 'new', label: 'Not studied' },
  { key: 'learning', label: 'Learning' },
  { key: 'known', label: 'Known' },
  { key: 'mastered', label: 'Mastered' },
];

const ORDER = LEVELS.map(level => level.key);
// Learn's levels (lib/learnEngine.mjs) on this scale: New, Learning, Familiar = known, Mastered.
const LEARN_SCALE = ['new', 'learning', 'known', 'mastered'];

// Flashcards: box 0 or missed = learning; box 1-2 or known = known; box 3+ = mastered
// (lib/spacedReview.mjs). Learn's level for the same question (learnLevels, the guide summary's
// flashcard_learn) counts too; the stronger of the two wins, so studying in either shows here.
export function cardLevel(progress, index, learnLevels) {
  const entry = progress?.schedule?.[index];
  let level = 'new';
  if (entry) level = entry.box >= 3 ? 'mastered' : entry.box >= 1 ? 'known' : 'learning';
  else if ((progress?.known || []).includes(index)) level = 'known';
  else if ((progress?.unknown || []).includes(index)) level = 'learning';
  const learned = LEARN_SCALE[learnLevels?.[index]] || 'new';
  return ORDER.indexOf(learned) > ORDER.indexOf(level) ? learned : level;
}

function seeded(seed) {
  let value = seed % 2147483647 || 1;
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
}

function buildScene(guides) {
  const chosen = guides.filter(guide => Number(guide.flashcard_count) > 0).slice(0, MAX_GUIDES);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const clusters = chosen.map((guide, index) => {
    // Cluster centres spread evenly over a sphere (Fibonacci lattice).
    const y = chosen.length === 1 ? 0 : 1 - (index / (chosen.length - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = golden * index;
    return { guide, x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
  });
  const points = [];
  clusters.forEach((cluster, clusterIndex) => {
    const count = Math.min(MAX_CARDS, Number(cluster.guide.flashcard_count) || 0);
    const random = seeded(clusterIndex * 7919 + count * 31 + 7);
    for (let card = 0; card < count; card += 1) {
      const spread = 0.34 + 0.16 * random();
      points.push({
        cluster: clusterIndex,
        card,
        level: cardLevel(cluster.guide.flashcard_progress, card, cluster.guide.flashcard_learn),
        x: cluster.x * 0.82 + (random() - 0.5) * spread,
        y: cluster.y * 0.82 + (random() - 0.5) * spread,
        z: cluster.z * 0.82 + (random() - 0.5) * spread,
      });
    }
  });
  return { clusters, points };
}

export default function KnowledgeMap({ guides }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const angle = useRef({ y: 0.6, x: -0.25, vy: 0.0025 });
  const dragFrom = useRef(null);
  const hits = useRef([]);
  const [hover, setHover] = useState(null);
  const scene = useMemo(() => buildScene(guides || []), [guides]);
  const totals = useMemo(() => LEVELS.map(level => ({ ...level, count: scene.points.filter(point => point.level === level.key).length })), [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !scene.points.length) return undefined;
    const context = canvas.getContext('2d');
    const still = prefersReducedMotion();
    const colors = {
      new: tokenColor('--muted', 'gray'),
      learning: tokenColor('--warning', 'gray'),
      known: tokenColor('--olive-ink', 'gray'),
      mastered: tokenColor('--success', 'gray'),
      line: tokenColor('--hairline', 'gray'),
      ink: tokenColor('--ink', 'gray'),
    };
    let width = 0;
    let height = 0;
    let frame = 0;
    function resize() {
      const ratio = window.devicePixelRatio || 1;
      width = wrap.clientWidth;
      height = Math.min(420, Math.max(280, width * 0.6));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.height = height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    resize();
    // Resizing clears the canvas, so a still map (reduced motion) is drawn again right after.
    const observer = new ResizeObserver(() => { resize(); if (still) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } });
    observer.observe(wrap);

    function project(point) {
      const { x: ax, y: ay } = angle.current;
      const cosY = Math.cos(ay), sinY = Math.sin(ay), cosX = Math.cos(ax), sinX = Math.sin(ax);
      const x1 = point.x * cosY - point.z * sinY;
      const z1 = point.x * sinY + point.z * cosY;
      const y1 = point.y * cosX - z1 * sinX;
      const z2 = point.y * sinX + z1 * cosX;
      const scale = Math.min(width, height) * 0.38;
      const depth = 2.6 / (2.6 + z2);
      return { sx: width / 2 + x1 * scale * depth, sy: height / 2 + y1 * scale * depth, depth, z: z2 };
    }

    function draw() {
      if (!dragFrom.current && !still) angle.current.y += angle.current.vy;
      context.clearRect(0, 0, width, height);
      const centres = scene.clusters.map(cluster => project(cluster));
      const placed = scene.points.map(point => ({ point, ...project(point) })).sort((a, b) => b.z - a.z);
      // Threads from each card to its guide's centre.
      context.lineWidth = 1;
      context.strokeStyle = colors.line;
      context.beginPath();
      for (const item of placed) {
        const centre = centres[item.point.cluster];
        context.moveTo(centre.sx, centre.sy);
        context.lineTo(item.sx, item.sy);
      }
      context.stroke();
      hits.current = [];
      for (const item of placed) {
        const radius = (item.point.level === 'mastered' ? 6 : 5) * item.depth;
        context.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, (item.depth - 0.7) / 0.6));
        context.fillStyle = colors[item.point.level];
        context.beginPath();
        context.arc(item.sx, item.sy, radius, 0, Math.PI * 2);
        context.fill();
        if (item.point.level === 'mastered') {
          context.globalAlpha *= 0.25;
          context.beginPath();
          context.arc(item.sx, item.sy, radius * 2.4, 0, Math.PI * 2);
          context.fill();
        }
        hits.current.push({ x: item.sx, y: item.sy, r: Math.max(6, radius + 3), point: item.point });
      }
      context.globalAlpha = 1;
      // Guide names on the clusters facing the viewer.
      context.font = '600 13px Manrope, system-ui, sans-serif';
      context.textAlign = 'center';
      scene.clusters.forEach((cluster, index) => {
        const centre = centres[index];
        if (centre.z > -0.1) return;
        context.globalAlpha = Math.min(1, (-centre.z - 0.1) * 2.5);
        context.fillStyle = colors.ink;
        const title = cluster.guide.title || 'Untitled guide';
        context.fillText(title.length > 26 ? title.slice(0, 25) + '…' : title, centre.sx, centre.sy - 40 * centre.depth);
      });
      context.globalAlpha = 1;
      if (!still || dragFrom.current) frame = requestAnimationFrame(draw);
    }
    draw();
    const redraw = () => { if (still) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } };
    wrap.addEventListener('cordia:map-redraw', redraw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); wrap.removeEventListener('cordia:map-redraw', redraw); };
  }, [scene]);

  function onPointerDown(event) {
    dragFrom.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    wrapRef.current?.dispatchEvent(new Event('cordia:map-redraw'));
  }
  function onPointerMove(event) {
    if (dragFrom.current) {
      angle.current.y += (event.clientX - dragFrom.current.x) * 0.008;
      angle.current.x = Math.max(-1.2, Math.min(1.2, angle.current.x + (event.clientY - dragFrom.current.y) * 0.006));
      dragFrom.current = { x: event.clientX, y: event.clientY };
      wrapRef.current?.dispatchEvent(new Event('cordia:map-redraw'));
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const hit = [...hits.current].reverse().find(item => (item.x - x) ** 2 + (item.y - y) ** 2 <= item.r ** 2);
    setHover(hit ? { x, y, point: hit.point } : null);
  }
  function onPointerUp() { dragFrom.current = null; }

  if (!scene.points.length) {
    return (
      <section className="c-card kmap kmap-empty" aria-labelledby="kmap-title">
        <h2 id="kmap-title" className="c-section-title">Knowledge map</h2>
        <p className="c-meta">Make flashcards from a guide and your map starts here: every card becomes a point that lights up as you learn it.</p>
        <style jsx>{`.kmap { display: grid; gap: 8px; padding: 20px; } .kmap p { margin: 0; }`}</style>
      </section>
    );
  }

  const hoverGuide = hover ? scene.clusters[hover.point.cluster].guide : null;
  return (
    <section className="c-card kmap" aria-labelledby="kmap-title">
      <div className="kmap-head">
        <h2 id="kmap-title" className="c-section-title">Knowledge map</h2>
        <span className="c-meta">Drag to turn it</span>
      </div>
      <div ref={wrapRef} className="kmap-stage">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Knowledge map of ${scene.points.length} flashcards across ${scene.clusters.length} guides: ${totals.map(level => `${level.count} ${level.label.toLowerCase()}`).join(', ')}.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
        />
        {hover && (
          <div className="kmap-tip" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
            <strong>{hoverGuide.title || 'Untitled guide'}</strong>
            <span>Card {hover.point.card + 1} · {LEVELS.find(level => level.key === hover.point.level).label}</span>
          </div>
        )}
      </div>
      <ul className="kmap-legend">
        {totals.map(level => <li key={level.key}><i className={'is-' + level.key} aria-hidden="true" />{level.label}<strong>{level.count}</strong></li>)}
      </ul>
      <details className="kmap-list">
        <summary className="c-meta">By guide</summary>
        <ul>
          {scene.clusters.map(({ guide }) => {
            const count = Math.min(MAX_CARDS, Number(guide.flashcard_count) || 0);
            const learned = Array.from({ length: count }, (_, index) => cardLevel(guide.flashcard_progress, index, guide.flashcard_learn)).filter(level => level === 'known' || level === 'mastered').length;
            return <li key={guide.id}><Link href={'/flashcards/study?guideId=' + guide.id}>{guide.title || 'Untitled guide'}</Link><span className="c-meta">{learned} of {count} known</span></li>;
          })}
        </ul>
      </details>
      <style jsx>{`
        .kmap { display: grid; gap: 12px; padding: 20px; min-width: 0; }
        .kmap-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .kmap-stage { position: relative; min-width: 0; }
        .kmap-stage canvas { display: block; width: 100%; cursor: grab; touch-action: pan-y; }
        .kmap-stage canvas:active { cursor: grabbing; }
        .kmap-tip { position: absolute; transform: translate(-50%, calc(-100% - 12px)); display: grid; gap: 2px; padding: 8px 10px; border-radius: var(--r-input); background: var(--surface-raised, var(--card)); box-shadow: var(--shadow-float, var(--shadow)); font: 500 var(--fs-13)/1.3 var(--font-sans); white-space: nowrap; pointer-events: none; }
        .kmap-tip strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
        .kmap-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 var(--fs-13)/1 var(--font-sans); color: var(--muted); }
        .kmap-legend li { display: inline-flex; align-items: center; gap: 6px; }
        .kmap-legend strong { color: var(--ink); font-variant-numeric: tabular-nums; }
        .kmap-legend i { width: 10px; height: 10px; border-radius: 50%; }
        .is-new { background: var(--muted); }
        .is-learning { background: var(--warning); }
        .is-known { background: var(--olive-ink); }
        .is-mastered { background: var(--success); box-shadow: 0 0 0 3px var(--success-bg); }
        .kmap-list ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
        .kmap-list li { display: flex; justify-content: space-between; gap: 12px; min-width: 0; }
        .kmap-list a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
        .kmap-list summary { cursor: pointer; }
      `}</style>
    </section>
  );
}
