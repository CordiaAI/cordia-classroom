// Geometry for the walkthrough spotlight (components/Spotlight.js), kept free of the DOM so it can
// be tested: the cut-out's corners, and where the label and Skip go so neither covers the
// spotlighted control or the Tutor button.

// One computed corner radius ("12px", "999px", "50%", "12px 8px", "") as px for a box w × h.
// A percentage is of the box's width (horizontal) and height (vertical); the smaller is kept, so a
// corner is drawn round. A radius bigger than half the box is clamped there, as the browser draws it.
export function cornerPx(value, w, h) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  const read = (part, side) => {
    if (!part) return 0;
    const n = parseFloat(part);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return part.endsWith('%') ? (n / 100) * side : n;
  };
  const x = read(parts[0], w);
  const y = read(parts[1] || parts[0], h);
  return Math.max(0, Math.min(x, y, w / 2, h / 2));
}

// The cut-out's four corners (top left, top right, bottom right, bottom left) for a target with
// the given computed corners, padded by pad on every side to a hole of hole.w × hole.h. Each corner
// is the target's own radius plus the padding, so the hole's edge stays the same distance from the
// control all the way round (a square corner gets the padding as its radius), clamped to half the
// hole, so a pill gets a pill and a circle a circle.
export function cutoutRadii(corners, target, hole, pad) {
  const max = Math.max(0, Math.min(hole.w, hole.h) / 2);
  return corners.map(value => Math.min(cornerPx(value, target.w, target.h) + pad, max));
}

// An SVG path (for clip-path: path(evenodd, ...)) covering a vw × vh screen except a rounded hole.
export function holePath(vw, vh, hole, radii) {
  const [tl, tr, br, bl] = radii;
  const { left: l, top: t, right: r, bottom: b } = hole;
  const f = n => Math.round(n * 100) / 100;
  return [
    `M0 0H${f(vw)}V${f(vh)}H0Z`,
    `M${f(l + tl)} ${f(t)}H${f(r - tr)}`,
    tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(r)} ${f(t + tr)}` : '',
    `V${f(b - br)}`,
    br ? `A${f(br)} ${f(br)} 0 0 1 ${f(r - br)} ${f(b)}` : '',
    `H${f(l + bl)}`,
    bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(l)} ${f(b - bl)}` : '',
    `V${f(t + tl)}`,
    tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(l + tl)} ${f(t)}` : '',
    'Z',
  ].join('');
}

// Boxes are { left, top, right, bottom }. Two boxes overlap when they share any area, with gap
// pixels of clearance asked for between them.
export function overlaps(a, b, gap = 0) {
  if (!a || !b) return false;
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

const box = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

// Where the label goes: under the control if there is room, else over it; centred on it and kept
// edge pixels inside the screen. A spot that would cover anything in avoid (the Tutor button) is
// skipped for the next: the other side, then the same sides moved left or right clear of it.
// Returns { top, left, arrow } with arrow 'up' (label under the control), 'down' or 'none'.
export function placeLabel({ vw, vh, hole, size, avoid = [], edge = 16, gap = 14, clear = 12 }) {
  const lw = size.w;
  const lh = size.h || 48;
  const targetX = (hole.left + hole.right) / 2;
  const centred = Math.max(edge, Math.min(vw - edge - lw, targetX - lw / 2));
  const lefts = [centred];
  for (const other of avoid) {
    const leftOf = other.left - clear - lw;
    const rightOf = other.right + clear;
    if (leftOf >= edge) lefts.push(Math.min(leftOf, vw - edge - lw));
    if (rightOf + lw <= vw - edge) lefts.push(Math.max(edge, rightOf));
  }
  const rows = [];
  if (hole.bottom + gap + lh <= vh - edge) rows.push({ top: hole.bottom + gap, arrow: 'up' });
  if (hole.top - gap - lh >= edge) rows.push({ top: hole.top - gap - lh, arrow: 'down' });
  for (const row of rows) {
    for (const left of lefts) {
      if (!avoid.some(other => overlaps(box(left, row.top, lw, lh), other, clear))) return { ...row, left };
    }
  }
  // No side is clear: rest above whatever must stay uncovered, else at the bottom edge.
  const floor = Math.min(vh - edge, ...avoid.map(other => other.top - clear));
  const top = Math.max(edge, floor - lh);
  return { top, left: centred, arrow: 'none' };
}

// Where Skip goes. Desktop: the bottom-right corner, to the left of the Tutor button when it is
// there, then the bottom-left, then the top-right. Phones: under the top bar at the right, then at
// the left, then above the tab bar at the left. The first spot that covers none of avoid (the hole,
// the label, the Tutor button) wins. Returns { top, left }.
export function placeSkip({ vw, vh, phone, size, avoid = [], tutor = null, barH = 64, tabbarH = 64, inset = 24, clear = 8 }) {
  const { w, h } = size;
  const spots = [];
  if (phone) {
    spots.push({ top: barH + 12, left: vw - 12 - w });
    spots.push({ top: barH + 12, left: 12 });
    spots.push({ top: vh - tabbarH - 12 - h, left: 12 });
  } else {
    const right = tutor ? Math.min(vw - inset, tutor.left - 12) : vw - inset;
    const top = Math.min(tutor ? Math.round((tutor.top + tutor.bottom) / 2 - h / 2) : vh - inset - h, vh - inset - h);
    spots.push({ top, left: right - w });
    // Still in that row, left of everything else in it too (the spotlighted control, when it sits
    // beside the Tutor button or is the Tutor button).
    const row = { left: 0, top, right: vw, bottom: top + h };
    const inRow = [tutor, ...avoid].filter(other => other && overlaps(row, other, clear));
    if (inRow.length) spots.push({ top, left: Math.min(right, ...inRow.map(other => other.left - 12)) - w });
    spots.push({ top: vh - inset - h, left: inset });
    spots.push({ top: inset, left: vw - inset - w });
  }
  const blockers = tutor ? [...avoid, tutor] : avoid;
  const onScreen = spot => spot.left >= 0 && spot.top >= 0 && spot.left + w <= vw && spot.top + h <= vh;
  return spots.find(spot => onScreen(spot) && !blockers.some(other => overlaps(box(spot.left, spot.top, w, h), other, clear))) || spots[0];
}
