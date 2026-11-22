import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cornerPx, cutoutRadii, holePath, overlaps, placeLabel, placeSkip } from '../lib/spotlightLayout.mjs';

const PAD = 8;
const holeOf = (left, top, w, h) => ({ left: left - PAD, top: top - PAD, right: left + w + PAD, bottom: top + h + PAD });
const radii = (corners, w, h) => cutoutRadii(corners, { w, h }, { w: w + 2 * PAD, h: h + 2 * PAD }, PAD);

test('computed corners read as px: lengths, percentages, two-value corners, and clamped to half the box', () => {
  assert.equal(cornerPx('12px', 100, 40), 12);
  assert.equal(cornerPx('999px', 120, 44), 22);
  assert.equal(cornerPx('50%', 48, 48), 24);
  assert.equal(cornerPx('50%', 200, 40), 20);
  assert.equal(cornerPx('16px 8px', 100, 100), 8);
  assert.equal(cornerPx('0px', 100, 40), 0);
  assert.equal(cornerPx('', 100, 40), 0);
});

test('the cut-out is the control\'s own radius plus the padding: a pill gets a pill, a circle a circle', () => {
  // A 12px card corner: 12 + 8.
  assert.deepEqual(radii(Array(4).fill('12px'), 200, 60), [20, 20, 20, 20]);
  // A pill (999px) 120 × 44: the hole is 136 × 60 and every corner is 30, half its height.
  assert.deepEqual(radii(Array(4).fill('999px'), 120, 44), [30, 30, 30, 30]);
  // A 48px circle (50%): the hole is 64 × 64 and every corner is 32, a circle again.
  assert.deepEqual(radii(Array(4).fill('50%'), 48, 48), [32, 32, 32, 32]);
  // A square control still gets the padding, so the gap is the same all the way round.
  assert.deepEqual(radii(Array(4).fill('0px'), 300, 200), [8, 8, 8, 8]);
  // Mixed corners keep their own shape.
  assert.deepEqual(radii(['20px', '20px', '0px', '0px'], 300, 200), [28, 28, 8, 8]);
  // A hole cut short by the screen edge never gets corners bigger than half of it.
  assert.deepEqual(cutoutRadii(Array(4).fill('999px'), { w: 120, h: 44 }, { w: 136, h: 40 }, PAD), [20, 20, 20, 20]);
});

test('the dim layer\'s path is the screen minus a rounded hole', () => {
  const path = holePath(1440, 900, { left: 100, top: 50, right: 236, bottom: 110 }, [30, 30, 30, 30]);
  assert.match(path, /^M0 0H1440V900H0Z/);
  assert.match(path, /M130 50H206A30 30 0 0 1 236 80V80A30 30 0 0 1 206 110H130A30 30 0 0 1 100 80V80A30 30 0 0 1 130 50Z$/);
});

// The Tutor button as TutorBubble draws it: 56px tall, 24px up, left of the 64px rail on desktop;
// 48px round above the tab bar on phones.
const desktopTutor = (vw, vh) => ({ left: vw - 88 - 100, top: vh - 24 - 56, right: vw - 88, bottom: vh - 24 });
const phoneTutor = (vw, vh) => ({ left: vw - 12 - 48, top: vh - 64 - 12 - 48, right: vw - 12, bottom: vh - 64 - 12 });
const SKIP = { w: 82, h: 44 };
const LABEL = { w: 320, h: 48 };
const box = (spot, size) => ({ left: spot.left, top: spot.top, right: spot.left + size.w, bottom: spot.top + size.h });

test('Skip and the label never cover the Tutor button, at any of the checked sizes', () => {
  const sizes = [[1440, 900], [1024, 768], [390, 844], [360, 640], [768, 1024]];
  for (const [vw, vh] of sizes) {
    const phone = vw < 768;
    const tutor = phone ? phoneTutor(vw, vh) : desktopTutor(vw, vh);
    // Controls all over the screen, including the bottom-right corner next to the Tutor button.
    const targets = [[24, 24, 200, 44], [vw / 2 - 60, vh / 2 - 22, 120, 44], [vw - 260, vh - 90, 120, 44], [24, vh - 140, 200, 44], [vw - 140, 80, 120, 44]];
    for (const [left, top, w, h] of targets) {
      const hole = holeOf(left, top, w, h);
      const label = placeLabel({ vw, vh, hole, size: LABEL, avoid: [tutor] });
      const labelBox = box(label, LABEL);
      assert.equal(overlaps(labelBox, tutor), false, `label covers the Tutor button at ${vw}×${vh}, target ${left},${top}`);
      const skip = placeSkip({ vw, vh, phone, size: SKIP, avoid: [hole, labelBox], tutor });
      const skipBox = box(skip, SKIP);
      assert.equal(overlaps(skipBox, tutor), false, `Skip covers the Tutor button at ${vw}×${vh}, target ${left},${top}`);
      assert.equal(overlaps(skipBox, hole), false, `Skip covers the control at ${vw}×${vh}, target ${left},${top}`);
      assert.ok(skip.left >= 0 && skip.top >= 0 && skipBox.right <= vw && skipBox.bottom <= vh, `Skip is off screen at ${vw}×${vh}`);
    }
  }
});

test('on desktop Skip sits in the bottom-right corner, left of the Tutor button and centred on it', () => {
  const tutor = desktopTutor(1440, 900);
  const skip = placeSkip({ vw: 1440, vh: 900, phone: false, size: SKIP, avoid: [holeOf(600, 400, 120, 44)], tutor });
  assert.equal(skip.left + SKIP.w, tutor.left - 12);
  assert.equal(skip.top + SKIP.h / 2, (tutor.top + tutor.bottom) / 2);
  // Spotlighting the Tutor button itself: Skip moves left of the cut-out too.
  const hole = holeOf(tutor.left, tutor.top, 100, 56);
  const beside = placeSkip({ vw: 1440, vh: 900, phone: false, size: SKIP, avoid: [hole], tutor: null });
  assert.equal(overlaps(box(beside, SKIP), hole, 8), false);
  // Without a Tutor button, the corner itself.
  assert.deepEqual(placeSkip({ vw: 1440, vh: 900, phone: false, size: SKIP, avoid: [] }), { top: 900 - 24 - 44, left: 1440 - 24 - 82 });
});

test('Spotlight reads the control\'s computed corners and the Tutor button, and draws the hole with them', async () => {
  const spotlight = await readFile(new URL('../components/Spotlight.js', import.meta.url), 'utf8');
  assert.match(spotlight, /getComputedStyle\(element\)/);
  assert.match(spotlight, /borderTopLeftRadius/);
  assert.match(spotlight, /visibleElement\('\.c-tutor-bubble'\)/);
  assert.match(spotlight, /clipPath: `path\(evenodd/);
  assert.doesNotMatch(spotlight, /border-radius:12px/);
  assert.doesNotMatch(spotlight, /transition: all/);
});
