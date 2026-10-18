// Air drawing gestures with synthetic hand landmarks (no camera): smoothing, mirroring,
// pinch hysteresis, middle-finger erase, the 100 ms start anchor and the open-palm clear.
import assert from 'node:assert/strict';
import { AIR_CONFIG, OneEuroFilter, createGestureTracker, drawStroke } from '../lib/airDraw.mjs';

const BOARD = { width: 800, height: 600, aspect: 1 };

// A hand in normalized camera coordinates. Hand size (wrist -> middle MCP) is 0.2.
function hand({ tipX = 0.5, tipY = 0.5, pinch = 'none', palm = false } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  lm[0] = { x: 0.5, y: 0.8 };                 // wrist
  lm[9] = { x: 0.5, y: 0.6 };                 // middle MCP -> hand size 0.2
  lm[5] = { x: 0.45, y: 0.62 };               // index MCP
  lm[6] = { x: 0.45, y: 0.55 }; lm[10] = { x: 0.5, y: 0.52 }; lm[14] = { x: 0.55, y: 0.55 }; lm[18] = { x: 0.6, y: 0.58 };
  lm[8] = { x: tipX, y: tipY };               // index tip (the pen)
  lm[12] = { x: 0.5, y: palm ? 0.35 : 0.62 }; // middle tip
  lm[16] = { x: 0.55, y: palm ? 0.38 : 0.62 }; lm[20] = { x: 0.6, y: palm ? 0.42 : 0.66 };
  lm[4] = { x: 0.3, y: 0.7 };                 // thumb tip, far away (open)
  if (pinch === 'index') lm[4] = { x: tipX + 0.02, y: tipY };          // 0.1 of hand size
  if (pinch === 'half') lm[4] = { x: tipX + 0.08, y: tipY };           // 0.4: between press and release
  if (pinch === 'middle') lm[4] = { x: lm[12].x + 0.02, y: lm[12].y };
  if (palm) { lm[8] = { x: 0.45, y: 0.3 }; lm[4] = { x: 0.25, y: 0.65 }; }
  return lm;
}

// One Euro: a still point stays put; jitter is reduced.
{
  const filter = new OneEuroFilter(AIR_CONFIG.filter);
  let out = 0;
  for (let i = 0; i < 60; i += 1) out = filter.filter(100 + (i % 2 ? 3 : -3), i / 30);
  assert.ok(Math.abs(out - 100) < 1.5, `jitter not smoothed: ${out}`);
  console.log('ok   One Euro filter smooths jitter');
}

// Mirrored: the tip on the camera's left (x = 0.2) is on the board's right.
{
  const tracker = createGestureTracker();
  const state = tracker.update(hand({ tipX: 0.2, tipY: 0.5 }), 0, BOARD);
  assert.ok(state.visible && state.x > BOARD.width / 2, `not mirrored: ${state.x}`);
  assert.equal(state.mode, 'hover');
  console.log('ok   cursor is mirrored and visible while hovering');
}

// Pinch hysteresis: press below 0.32, stays down at 0.4, lifts only above 0.48.
{
  const tracker = createGestureTracker();
  let t = 0;
  const step = opts => { t += 33; return tracker.update(hand(opts), t, BOARD); };
  step({}); step({});
  const down = step({ pinch: 'index' });
  assert.equal(down.mode, 'draw');
  assert.equal(down.events[0].type, 'start');
  assert.equal(down.events[0].tool, 'pen');
  const held = step({ pinch: 'half' });
  assert.equal(held.mode, 'draw', 'lifted inside the hysteresis band');
  const up = step({});
  assert.equal(up.mode, 'hover');
  assert.ok(up.events.some(event => event.type === 'end'));
  const notPressed = createGestureTracker();
  notPressed.update(hand({}), 0, BOARD);
  assert.equal(notPressed.update(hand({ pinch: 'half' }), 33, BOARD).mode, 'hover', 'pressed inside the band');
  console.log('ok   pinch press/release hysteresis');
}

// Stabilize: the stroke starts where the finger pointed ~100 ms before the pinch, and the
// cursor holds there for 100 ms before moves are emitted.
{
  const tracker = createGestureTracker();
  let t = 0;
  for (let i = 0; i < 10; i += 1) { t += 33; tracker.update(hand({ tipX: 0.5, tipY: 0.5 }), t, BOARD); }
  const resting = tracker.update(hand({ tipX: 0.5, tipY: 0.5 }), (t += 33), BOARD);
  const start = tracker.update(hand({ tipX: 0.47, tipY: 0.53, pinch: 'index' }), (t += 33), BOARD);
  const anchor = start.events.find(event => event.type === 'start').point;
  assert.ok(Math.hypot(anchor.x - resting.x, anchor.y - resting.y) < 2, 'start drifted with the pinch');
  const during = tracker.update(hand({ tipX: 0.4, tipY: 0.5, pinch: 'index' }), (t += 33), BOARD);
  assert.equal(during.events.length, 0, 'moved during the 100 ms hold');
  assert.equal(during.x, anchor.x);
  t += 120;
  const after = tracker.update(hand({ tipX: 0.4, tipY: 0.5, pinch: 'index' }), t, BOARD);
  assert.equal(after.events[0]?.type, 'move');
  console.log('ok   100 ms start stabilization');
}

// Middle finger + thumb: eraser.
{
  const tracker = createGestureTracker();
  tracker.update(hand({}), 0, BOARD);
  const state = tracker.update(hand({ pinch: 'middle' }), 33, BOARD);
  assert.equal(state.mode, 'erase');
  assert.equal(state.events[0].tool, 'eraser');
  console.log('ok   middle pinch erases');
}

// Open palm held still for 1.5 s: progress rises, then one clear; it re-arms after the palm closes.
{
  const tracker = createGestureTracker();
  let t = 0;
  let clears = 0;
  let halfway = 0;
  for (; t <= 1700; t += 33) {
    const state = tracker.update(hand({ palm: true }), t, BOARD);
    if (t >= 700 && t < 800) halfway = state.palmProgress;
    clears += state.events.filter(event => event.type === 'clear').length;
  }
  assert.ok(halfway > 0.4 && halfway < 0.6, `countdown at 0.75 s: ${halfway}`);
  assert.equal(clears, 1, 'cleared more than once in one hold');
  for (let i = 0; i < 5; i += 1) tracker.update(hand({}), (t += 33), BOARD);
  for (const end = t + 1600; t <= end; t += 33) clears += tracker.update(hand({ palm: true }), t, BOARD).events.filter(e => e.type === 'clear').length;
  assert.equal(clears, 2, 'did not re-arm');
  // A moving palm never clears.
  const moving = createGestureTracker();
  let moved = 0;
  for (let k = 0, time = 0; k < 60; k += 1, time += 33) {
    const lm = hand({ palm: true }).map(p => ({ x: p.x + (k % 10) * 0.02, y: p.y }));
    moved += moving.update(lm, time, BOARD).events.filter(e => e.type === 'clear').length;
  }
  assert.equal(moved, 0);
  console.log('ok   open palm hold clears once, with a countdown');
}

// Lost hand mid-stroke ends the stroke.
{
  const tracker = createGestureTracker();
  tracker.update(hand({}), 0, BOARD);
  tracker.update(hand({ pinch: 'index' }), 33, BOARD);
  const gone = tracker.update(null, 66, BOARD);
  assert.equal(gone.visible, false);
  assert.ok(gone.events.some(event => event.type === 'end'));
  console.log('ok   losing the hand lifts the pen');
}

// Strokes render as quadratic curves.
{
  const calls = [];
  const context = new Proxy({}, { get: (_, key) => (typeof key === 'string' && /^[a-z]/.test(key) && !['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalCompositeOperation'].includes(key) ? (...args) => calls.push(key) : undefined), set: () => true });
  drawStroke(context, { tool: 'pen', color: '--draw-ink', size: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 8 }] }, 'black');
  assert.equal(calls.filter(name => name === 'quadraticCurveTo').length, 2);
  console.log('ok   strokes use quadratic curves');
}

console.log('air drawing ok');
