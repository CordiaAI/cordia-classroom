// Air drawing: hand landmarks -> a smoothed cursor and pen gestures, plus the stroke renderer
// shared by mouse, touch and hand input on the Practice board. No React, no DOM: the
// component in components/AirDraw.js feeds it landmarks once per video frame.

// Tuning. Pinch distances use MediaPipe's 3D world landmarks (metres), divided by hand size
// (wrist to middle-finger base), so they hold however the hand is turned or how far away it is.
export const AIR_CONFIG = {
  pinchPress: 0.2,       // fingertips this close (x hand size) -> pen down; real touching is ~0.1-0.17
  pinchRelease: 0.3,     // and this far apart -> pen up (the small gap stops flicker)
  pressFrames: 2,        // a pinch must hold this many frames in a row to count (ignores one-frame noise)
  releaseFrames: 2,      // and must be open this many frames to lift
  trimMs: 90,            // points are drawn this long behind the finger, so the opening of a pinch never leaves a tail
  stabilizeMs: 100,      // the cursor holds still this long when a pinch starts
  anchorLookbackMs: 160, // the stroke starts where the finger was this long before the pinch registered
  palmHoldMs: 1500,      // open palm held still this long clears the board
  palmStillPx: 36,       // the palm may drift this many px during the hold
  palmFingerRatio: 1.15, // a finger counts as open when tip-to-wrist > this x joint-to-wrist
  edgeMargin: 0.12,      // camera border left out of the drawing area (easier to reach the board's edges)
  filter: { minCutoff: 2.5, beta: 0.05, dCutoff: 1.0 }, // One Euro: lower minCutoff = steadier, higher beta = less lag
  eraserScale: 4,        // eraser width = brush size x this (min 16 px)
};

// Landmark indices (MediaPipe hand model).
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8, MIDDLE_MCP = 9, MIDDLE_PIP = 10;
const MIDDLE_DIP = 11, MIDDLE_TIP = 12, RING_PIP = 14, RING_TIP = 16, PINKY_PIP = 18, PINKY_TIP = 20;

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

// Camera -> board with the same scale on both axes, so a circle drawn in the air stays a
// circle (a wide board would otherwise stretch everything sideways). The drawing area is the
// largest box with the board's shape inside the camera frame, minus the edge margin.
export function cameraToBoard(lm, { width, height, aspect, margin }) {
  const boardAspect = width / Math.max(1, height);
  const innerW = (1 - 2 * margin) * aspect;   // camera units: x scaled by aspect, y 0..1
  const innerH = 1 - 2 * margin;
  let areaW = innerW;
  let areaH = innerW / boardAspect;
  if (areaH > innerH) { areaH = innerH; areaW = innerH * boardAspect; }
  const left = (aspect - areaW) / 2;
  const top = (1 - areaH) / 2;
  const nx = ((1 - lm.x) * aspect - left) / areaW; // mirrored, like looking in a mirror
  const ny = (lm.y - top) / areaH;
  return { x: Math.min(1, Math.max(0, nx)) * width, y: Math.min(1, Math.max(0, ny)) * height };
}

// Tracks one hand across frames. update() returns where the cursor is and what happened:
// events are { type: 'start', tool, point } | { type: 'move', point } | { type: 'end' } | { type: 'clear' }.
export function createGestureTracker(config = AIR_CONFIG) {
  const fx = new OneEuroFilter(config.filter);
  const fy = new OneEuroFilter(config.filter);
  let mode = 'hover';          // hover | draw | erase
  let candidate = null;        // pinch seen but not yet held long enough: { mode, frames }
  let openFrames = 0;
  let stabilizeUntil = 0;
  let anchor = null;
  let last = null;             // last filtered cursor
  let history = [];            // recent filtered cursor positions { x, y, t }
  let pending = [];            // stroke points not yet drawn (trimMs behind the finger)
  let palmStart = null;
  let palmOrigin = null;
  let palmArmed = true;

  function reset() {
    fx.reset(); fy.reset();
    last = null; anchor = null; palmStart = null; palmOrigin = null; history = []; pending = []; candidate = null; openFrames = 0;
  }

  // landmarks: 21 normalized {x, y}; world: the same 21 points in metres (optional);
  // aspect: video width / height; width/height: board px.
  function update(landmarks, timeMs, { width, height, aspect = 4 / 3, world = null }) {
    const events = [];
    if (!landmarks || landmarks.length < 21) {
      if (mode !== 'hover') { pending.forEach(point => events.push({ type: 'move', point })); events.push({ type: 'end' }); }
      mode = 'hover';
      reset();
      return { visible: false, mode, palmProgress: 0, events };
    }
    // Gesture distances in 3D when available (robust to tilt), else in the image.
    const points3d = world && world.length >= 21 ? world : null;
    const d = points3d
      ? (a, b) => Math.hypot(points3d[a].x - points3d[b].x, points3d[a].y - points3d[b].y, points3d[a].z - points3d[b].z)
      : (a, b) => Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y);
    const handSize = Math.max(1e-4, d(WRIST, MIDDLE_MCP));
    const indexPinch = d(THUMB_TIP, INDEX_TIP) / handSize;
    const middlePinch = d(THUMB_TIP, MIDDLE_TIP) / handSize;
    // A real pinch meets at the fingertip. A thumb resting along the finger (pointing pose,
    // or a fist) is closer to the finger's last joint than to its tip: that is not a pinch.
    const indexTouch = indexPinch < config.pinchPress && d(THUMB_TIP, INDEX_TIP) < d(THUMB_TIP, INDEX_DIP);
    const middleTouch = middlePinch < config.pinchPress && d(THUMB_TIP, MIDDLE_TIP) < d(THUMB_TIP, MIDDLE_DIP)
      && indexPinch > config.pinchRelease;

    const box = { width, height, aspect, margin: config.edgeMargin };
    const raw = cameraToBoard(landmarks[INDEX_TIP], box);
    const seconds = timeMs / 1000;
    const smooth = { x: fx.filter(raw.x, seconds), y: fy.filter(raw.y, seconds) };

    // Pen state: a pinch must hold pressFrames to go down and be open releaseFrames to lift.
    let next = mode;
    if (mode === 'hover') {
      const want = indexTouch ? 'draw' : middleTouch ? 'erase' : null;
      if (!want) candidate = null;
      else if (candidate?.mode === want) candidate.frames += 1;
      else candidate = { mode: want, frames: 1 };
      if (candidate && candidate.frames >= config.pressFrames) { next = candidate.mode; candidate = null; }
    } else {
      const open = mode === 'draw' ? indexPinch > config.pinchRelease : middlePinch > config.pinchRelease;
      openFrames = open ? openFrames + 1 : 0;
      if (openFrames >= config.releaseFrames) next = 'hover';
    }

    let cursor = smooth;
    if (next !== mode) {
      if (mode !== 'hover') {
        // Lifting: the newest points are the fingers opening, so drop them.
        pending = [];
        events.push({ type: 'end' });
        openFrames = 0;
      }
      if (next !== 'hover') {
        // Start where the finger was pointing before the pinch moved it.
        const before = history.find(item => item.t >= timeMs - config.anchorLookbackMs);
        anchor = before ? { x: before.x, y: before.y } : (last || smooth);
        stabilizeUntil = timeMs + config.stabilizeMs;
        pending = [];
        events.push({ type: 'start', tool: next === 'erase' ? 'eraser' : 'pen', point: anchor });
        cursor = anchor;
      }
      mode = next;
    } else if (mode !== 'hover') {
      if (timeMs < stabilizeUntil) cursor = anchor;
      else {
        pending.push({ x: smooth.x, y: smooth.y, t: timeMs });
        while (pending.length && pending[0].t <= timeMs - config.trimMs) {
          const { x, y } = pending.shift();
          events.push({ type: 'move', point: { x, y } });
        }
      }
    }

    // Open palm held still -> clear (once per hold).
    let palmProgress = 0;
    const open = (tip, pip) => d(WRIST, tip) > d(WRIST, pip) * config.palmFingerRatio;
    const palmOpen = mode === 'hover' && !candidate
      && open(INDEX_TIP, INDEX_PIP) && open(MIDDLE_TIP, MIDDLE_PIP) && open(RING_TIP, RING_PIP) && open(PINKY_TIP, PINKY_PIP)
      && d(THUMB_TIP, INDEX_MCP) / handSize > 0.45
      && indexPinch > config.pinchRelease && middlePinch > config.pinchRelease;
    if (palmOpen && palmArmed) {
      const center = cameraToBoard(landmarks[MIDDLE_MCP], box);
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
    while (history.length && history[0].t < timeMs - 400) history.shift();
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
