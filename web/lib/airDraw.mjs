// Air drawing: hand landmarks -> a smoothed cursor and pen gestures, plus the stroke renderer
// shared by mouse, touch and hand input on the Practice board. No React, no DOM: the
// component in components/AirDraw.js feeds it landmarks once per video frame.

// Tuning. Distances are divided by hand size (wrist to middle-finger base), so they hold
// whether the hand is near or far from the camera.
export const AIR_CONFIG = {
  pinchPress: 0.32,      // pinch closes below this -> pen down
  pinchRelease: 0.48,    // and must open past this -> pen up (hysteresis stops flicker)
  stabilizeMs: 100,      // the cursor holds still this long when a pinch starts
  palmHoldMs: 1500,      // open palm held still this long clears the board
  palmStillPx: 36,       // the palm may drift this many px during the hold
  palmFingerRatio: 1.15, // a finger counts as open when tip-to-wrist > this x joint-to-wrist
  edgeMargin: 0.12,      // this much of each camera edge maps past the board edge (easier to reach corners)
  filter: { minCutoff: 1.2, beta: 0.012, dCutoff: 1.0 }, // One Euro: lower minCutoff = steadier, higher beta = less lag
  eraserScale: 4,        // eraser width = brush size x this (min 16 px)
};

// Landmark indices (MediaPipe hand model).
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8, MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_TIP = 12;
const RING_PIP = 14, RING_TIP = 16, PINKY_PIP = 18, PINKY_TIP = 20;

// One Euro filter (Casiez et al. 2012): smooth when still, responsive when moving.
class LowPass {
  constructor() { this.value = null; }
  filter(x, alpha) { this.value = this.value === null ? x : alpha * x + (1 - alpha) * this.value; return this.value; }
}
const alphaFor = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuroFilter {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.lastTime = null; this.lastRaw = null; }
  // value in px, time in seconds
  filter(value, time) {
    if (this.lastTime === null || time <= this.lastTime) {
      this.lastTime = time; this.lastRaw = value;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = time - this.lastTime;
    const speed = this.dx.filter((value - this.lastRaw) / dt, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(speed);
    this.lastTime = time; this.lastRaw = value;
    return this.x.filter(value, alphaFor(cutoff, dt));
  }
}

// Tracks one hand across frames. update() returns where the cursor is and what happened:
// events are { type: 'start', tool, point } | { type: 'move', point } | { type: 'end' } | { type: 'clear' }.
export function createGestureTracker(config = AIR_CONFIG) {
  const fx = new OneEuroFilter(config.filter);
  const fy = new OneEuroFilter(config.filter);
  let mode = 'hover';          // hover | draw | erase
  let stabilizeUntil = 0;
  let anchor = null;
  let last = null;             // last filtered cursor
  let history = [];            // recent filtered cursor positions { x, y, t }
  let palmStart = null;
  let palmOrigin = null;
  let palmArmed = true;

  function reset() {
    fx.reset(); fy.reset();
    last = null; anchor = null; palmStart = null; palmOrigin = null; history = [];
  }

  // landmarks: 21 normalized {x, y}; aspect: video width / height; width/height: board px.
  function update(landmarks, timeMs, { width, height, aspect = 4 / 3 }) {
    const events = [];
    if (!landmarks || landmarks.length < 21) {
      if (mode !== 'hover') events.push({ type: 'end' });
      mode = 'hover';
      palmStart = null;
      reset();
      return { visible: false, mode, palmProgress: 0, events };
    }
    const d = (a, b) => Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y);
    const handSize = Math.max(1e-4, d(WRIST, MIDDLE_MCP));
    const indexPinch = d(THUMB_TIP, INDEX_TIP) / handSize;
    const middlePinch = d(THUMB_TIP, MIDDLE_TIP) / handSize;

    // Mirror x so moving right moves the cursor right, like a mirror.
    const toBoard = (lm) => {
      const m = config.edgeMargin;
      const nx = Math.min(1, Math.max(0, ((1 - lm.x) - m) / (1 - 2 * m)));
      const ny = Math.min(1, Math.max(0, (lm.y - m) / (1 - 2 * m)));
      return { x: nx * width, y: ny * height };
    };
    const raw = toBoard(landmarks[INDEX_TIP]);
    const seconds = timeMs / 1000;
    const smooth = { x: fx.filter(raw.x, seconds), y: fy.filter(raw.y, seconds) };

    // Pen state with hysteresis: press below pinchPress, release above pinchRelease.
    let next = mode;
    if (mode === 'draw' && indexPinch > config.pinchRelease) next = 'hover';
    else if (mode === 'erase' && middlePinch > config.pinchRelease) next = 'hover';
    else if (mode === 'hover') {
      if (indexPinch < config.pinchPress && indexPinch <= middlePinch) next = 'draw';
      else if (middlePinch < config.pinchPress) next = 'erase';
    }

    let cursor = smooth;
    if (next !== mode) {
      if (mode !== 'hover') events.push({ type: 'end' });
      if (next !== 'hover') {
        // Start where the finger was pointing just before the pinch moved it.
        const before = history.find(item => item.t >= timeMs - config.stabilizeMs);
        anchor = before ? { x: before.x, y: before.y } : (last || smooth);
        stabilizeUntil = timeMs + config.stabilizeMs;
        events.push({ type: 'start', tool: next === 'erase' ? 'eraser' : 'pen', point: anchor });
        cursor = anchor;
      }
      mode = next;
    } else if (mode !== 'hover') {
      if (timeMs < stabilizeUntil) cursor = anchor;
      else events.push({ type: 'move', point: smooth });
    }

    // Open palm held still -> clear (once per hold).
    let palmProgress = 0;
    const open = (tip, pip) => d(WRIST, tip) > d(WRIST, pip) * config.palmFingerRatio;
    const palmOpen = mode === 'hover'
      && open(INDEX_TIP, INDEX_PIP) && open(MIDDLE_TIP, MIDDLE_PIP) && open(RING_TIP, RING_PIP) && open(PINKY_TIP, PINKY_PIP)
      && d(THUMB_TIP, INDEX_MCP) / handSize > 0.45
      && indexPinch > config.pinchRelease && middlePinch > config.pinchRelease;
    if (palmOpen && palmArmed) {
      const center = toBoard(landmarks[MIDDLE_MCP]);
      if (!palmOrigin || Math.hypot(center.x - palmOrigin.x, center.y - palmOrigin.y) > config.palmStillPx) {
        palmOrigin = center; palmStart = timeMs;
      }
      palmProgress = Math.min(1, (timeMs - palmStart) / config.palmHoldMs);
      if (palmProgress >= 1) { events.push({ type: 'clear' }); palmArmed = false; palmStart = null; palmOrigin = null; }
    } else {
      palmStart = null; palmOrigin = null;
      if (!palmOpen) palmArmed = true;
    }

    last = smooth;
    history.push({ x: smooth.x, y: smooth.y, t: timeMs });
    while (history.length && history[0].t < timeMs - 300) history.shift();
    return { visible: true, x: cursor.x, y: cursor.y, mode, palmProgress, events };
  }

  return { update, reset, get mode() { return mode; } };
}

// ---- Strokes ---------------------------------------------------------------------------
// A stroke: { tool: 'pen' | 'eraser' | 'clear', color, size, points: [{ x, y }] } in CSS px.

export function strokeWidth(stroke, config = AIR_CONFIG) {
  return stroke.tool === 'eraser' ? Math.max(16, stroke.size * config.eraserScale) : stroke.size;
}

function prepare(context, stroke, color) {
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = strokeWidth(stroke);
  context.lineCap = 'round';
  context.lineJoin = 'round';
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function dot(context, p, stroke) {
  context.beginPath();
  context.arc(p.x, p.y, strokeWidth(stroke) / 2, 0, Math.PI * 2);
  context.fill();
}

// Whole stroke: quadratic curves through the midpoints, so it reads smooth, not jagged.
export function drawStroke(context, stroke, color) {
  const pts = stroke.points;
  if (!pts?.length) return;
  prepare(context, stroke, color);
  if (pts.length === 1) { dot(context, pts[0], stroke); return; }
  context.beginPath();
  context.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i += 1) {
    const m = mid(pts[i], pts[i + 1]);
    context.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  const end = pts[pts.length - 1];
  context.lineTo(end.x, end.y);
  context.stroke();
}

// Live drawing: the newest piece of the same curve, so the finished stroke matches drawStroke.
export function drawLatestSegment(context, stroke, color) {
  const pts = stroke.points;
  const n = pts.length;
  if (n < 2) { if (n === 1) { prepare(context, stroke, color); dot(context, pts[0], stroke); } return; }
  prepare(context, stroke, color);
  context.beginPath();
  if (n === 2) {
    const m = mid(pts[0], pts[1]);
    context.moveTo(pts[0].x, pts[0].y);
    context.lineTo(m.x, m.y);
  } else {
    const from = mid(pts[n - 3], pts[n - 2]);
    const to = mid(pts[n - 2], pts[n - 1]);
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(pts[n - 2].x, pts[n - 2].y, to.x, to.y);
  }
  context.stroke();
}

// The last half-segment, drawn when the pen lifts.
export function finishStroke(context, stroke, color) {
  const pts = stroke.points;
  const n = pts.length;
  if (n < 2) return;
  prepare(context, stroke, color);
  const from = mid(pts[n - 2], pts[n - 1]);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(pts[n - 1].x, pts[n - 1].y);
  context.stroke();
}

// Skip points closer than this (px) so slow hands don't pile up tiny segments.
export function farEnough(a, b, min = 1.5) {
  return !a || Math.hypot(a.x - b.x, a.y - b.y) >= min;
}
