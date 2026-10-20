// Air drawing gestures with synthetic hand landmarks (no camera): smoothing, mirroring, equal
// x/y scaling, pinch press/release with debounce, no false pinch from a resting thumb or depth,
// no tail when the pinch opens, middle-finger erase, the start anchor and the open-palm clear.
import assert from 'node:assert/strict';
import { AIR_CONFIG, OneEuroFilter, cameraToBoard, createGestureTracker, drawStroke } from '../lib/airDraw.mjs';

const BOARD = { width: 800, height: 600, aspect: 1 };

// A hand in normalized camera coordinates. Hand size (wrist -> middle MCP) is 0.2.
function hand({ tipX = 0.5, tipY = 0.5, pinch = 'none', palm = false } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  const set = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
  set(0, 0.5, 0.8);                 // wrist
  set(9, 0.5, 0.6);                 // middle MCP -> hand size 0.2
  set(5, 0.45, 0.62);               // index MCP
  set(6, 0.45, 0.55); set(10, 0.5, 0.52); set(14, 0.55, 0.55); set(18, 0.6, 0.58);
  set(8, tipX, tipY);               // index tip (the pen)
  set(7, tipX, tipY + 0.04);        // index DIP, just below the tip
  set(12, 0.5, palm ? 0.35 : 0.62); // middle tip
  set(11, 0.5, (palm ? 0.35 : 0.62) + 0.04);
  set(16, 0.55, palm ? 0.38 : 0.62); set(20, 0.6, palm ? 0.42 : 0.66);
  set(4, 0.3, 0.7);                 // thumb tip, far away (open)
  if (pinch === 'index') set(4, tipX + 0.02, tipY);              // 0.1 x hand size, at the tip
  if (pinch === 'half') set(4, tipX + 0.05, tipY);               // 0.25: between press and release
  if (pinch === 'side') set(4, tipX + 0.01, tipY + 0.035);       // resting against the last joint
  if (pinch === 'middle') set(4, lm[12].x + 0.02, lm[12].y);
  if (palm) { set(8, 0.45, 0.3); set(7, 0.45, 0.34); set(4, 0.25, 0.65); }
  return lm;
}

function run(frames, { start = 0, board = BOARD, tracker = createGestureTracker() } = {}) {
  let t = start;
  const out = [];
  for (const frame of frames) { t += 33; out.push(tracker.update(frame.lm ?? hand(frame), t, { ...board, world: frame.world })); }
  return { out, tracker, t, events: out.flatMap(state => state.events) };
}

// One Euro: a still point stays put; jitter is reduced.
{
  const filter = new OneEuroFilter(AIR_CONFIG.filter);
  let out = 0;
  for (let i = 0; i < 60; i += 1) out = filter.filter(100 + (i % 2 ? 3 : -3), i / 30);
  assert.ok(Math.abs(out - 100) < 2, `jitter not smoothed: ${out}`);
  console.log('ok   One Euro filter smooths jitter');
}

// Mirrored, and visible while hovering.
{
  const { out } = run([{ tipX: 0.2, tipY: 0.5 }]);
  assert.ok(out[0].visible && out[0].x > BOARD.width / 2, `not mirrored: ${out[0].x}`);
  assert.equal(out[0].mode, 'hover');
  console.log('ok   cursor is mirrored and visible while hovering');
}

// Equal scale on both axes: the same physical move gives the same number of board pixels,
// even on a wide board with a 4:3 camera (letters are no longer stretched sideways).
{
  const box = { width: 900, height: 450, aspect: 4 / 3, margin: AIR_CONFIG.edgeMargin };
  const a = cameraToBoard({ x: 0.5, y: 0.5 }, box);
  const right = cameraToBoard({ x: 0.5 - 0.075, y: 0.5 }, box); // 0.075 x 4/3 = 0.1 camera height
  const down = cameraToBoard({ x: 0.5, y: 0.6 }, box);
  const dx = right.x - a.x;
  const dy = down.y - a.y;
  assert.ok(Math.abs(dx - dy) < 0.5, `x scale ${dx} vs y scale ${dy}`);
  console.log('ok   same scale on x and y (no sideways stretch)');
}

// Pinch press needs 2 frames; stays down inside the band; lifts after 2 open frames.
{
  const { out } = run([{}, {}, { pinch: 'index' }, { pinch: 'index' }, { pinch: 'half' }, {}, {}]);
  assert.equal(out[2].mode, 'hover', 'went down on a single frame');
  assert.equal(out[3].mode, 'draw');
  assert.equal(out[3].events[0].type, 'start');
  assert.equal(out[3].events[0].tool, 'pen');
  assert.equal(out[4].mode, 'draw', 'lifted inside the band');
  assert.equal(out[5].mode, 'draw', 'lifted after one open frame');
  assert.equal(out[6].mode, 'hover');
  assert.ok(out[6].events.some(event => event.type === 'end'));
  console.log('ok   pinch press/release with debounce');
}

// No false pinches: a one-frame blip, a half-closed pinch, a thumb resting along the finger,
// or fingertips that only look close in 2D but are apart in depth.
{
  assert.ok(!run([{}, { pinch: 'index' }, {}, {}]).events.length, 'one-frame blip drew');
  assert.ok(!run([{}, { pinch: 'half' }, { pinch: 'half' }, { pinch: 'half' }]).events.length, 'half pinch drew');
  assert.ok(!run([{}, { pinch: 'side' }, { pinch: 'side' }, { pinch: 'side' }, { pinch: 'side' }]).events.length, 'resting thumb drew');
  const flat = hand({ pinch: 'index' });
  const world = flat.map(p => ({ x: p.x * 0.45, y: p.y * 0.45, z: 0 }));
  world[4] = { ...world[4], z: 0.04 }; // thumb 4 cm nearer the camera than the index tip
  assert.ok(!run([{}, { lm: flat, world }, { lm: flat, world }, { lm: flat, world }]).events.length, 'depth-separated tips drew');
  const touching = flat.map(p => ({ x: p.x * 0.45, y: p.y * 0.45, z: 0 }));
  assert.equal(run([{}, { lm: flat, world: touching }, { lm: flat, world: touching }]).out[2].mode, 'draw', '3D pinch not detected');
  console.log('ok   no false pinches (blip, half, resting thumb, depth)');
}

// The stroke starts where the finger pointed before the pinch, holds 100 ms, then follows.
{
  const tracker = createGestureTracker();
  const rest = run(Array.from({ length: 10 }, () => ({ tipX: 0.5, tipY: 0.5 })), { tracker });
  const resting = rest.out[rest.out.length - 1];
  const pinchIn = run([{ tipX: 0.48, tipY: 0.52, pinch: 'index' }, { tipX: 0.47, tipY: 0.53, pinch: 'index' }], { tracker, start: rest.t });
  const anchor = pinchIn.events.find(event => event.type === 'start').point;
  assert.ok(Math.hypot(anchor.x - resting.x, anchor.y - resting.y) < 3, 'start drifted with the pinch');
  const moving = run(Array.from({ length: 12 }, (_, i) => ({ tipX: 0.47 - i * 0.01, tipY: 0.53, pinch: 'index' })), { tracker, start: pinchIn.t });
  assert.equal(moving.out[0].events.length, 0, 'moved during the 100 ms hold');
  assert.ok(moving.events.some(event => event.type === 'move'), 'never followed the finger');
  console.log('ok   start anchor and 100 ms stabilization');
}

// Lifting the pen drops the last ~90 ms: the fingers opening never leaves a tail.
{
  const tracker = createGestureTracker();
  const draw = run([{}, { pinch: 'index' }, { pinch: 'index' }, ...Array.from({ length: 10 }, (_, i) => ({ tipX: 0.5 - i * 0.01, pinch: 'index' }))], { tracker });
  const lastDrawnX = Math.max(...draw.events.filter(e => e.type === 'move').map(e => e.point.x));
  // Opening: the fingertip flicks far while the pinch opens over two frames.
  const lift = run([{ tipX: 0.2 }, { tipX: 0.15 }], { tracker, start: draw.t });
  const tail = lift.events.filter(e => e.type === 'move');
  assert.ok(lift.events.some(e => e.type === 'end'));
  assert.ok(tail.every(e => e.point.x <= lastDrawnX + 60), `tail drawn to ${Math.max(...tail.map(e => e.point.x))}`);
  console.log('ok   no tail when the pinch opens');
}

// Middle finger + thumb: eraser (not when the index finger is pinched too).
{
  const { out } = run([{}, { pinch: 'middle' }, { pinch: 'middle' }]);
  assert.equal(out[2].mode, 'erase');
  assert.equal(out[2].events[0].tool, 'eraser');
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
  const moving = createGestureTracker();
  let moved = 0;
  for (let k = 0, time = 0; k < 60; k += 1, time += 33) {
    const lm = hand({ palm: true }).map(p => ({ ...p, x: p.x + (k % 10) * 0.02 }));
    moved += moving.update(lm, time, BOARD).events.filter(e => e.type === 'clear').length;
  }
  assert.equal(moved, 0);
  console.log('ok   open palm hold clears once, with a countdown');
}

// Lost hand mid-stroke ends the stroke.
{
  const tracker = createGestureTracker();
  run([{}, { pinch: 'index' }, { pinch: 'index' }], { tracker });
  const gone = tracker.update(null, 200, BOARD);
  assert.equal(gone.visible, false);
  assert.ok(gone.events.some(event => event.type === 'end'));
  console.log('ok   losing the hand lifts the pen');
}

// Strokes render as quadratic curves.
{
  const calls = [];
  const context = new Proxy({}, { get: (_, key) => (typeof key === 'string' && /^[a-z]/.test(key) && !['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalCompositeOperation'].includes(key) ? () => calls.push(key) : undefined), set: () => true });
  drawStroke(context, { tool: 'pen', color: '--draw-ink', size: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 8 }] }, 'black');
  assert.equal(calls.filter(name => name === 'quadraticCurveTo').length, 2);
  console.log('ok   strokes use quadratic curves');
}

console.log('air drawing ok');
