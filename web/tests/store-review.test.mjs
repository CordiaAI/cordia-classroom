// The Chrome Web Store review line after "Enjoying Cordia?" (lib/storeReview.mjs,
// components/StoreReviewLine.js, components/ReviewPrompt.js) and the extension's quiet rate link.
// Chrome Web Store policy: no incentives, and never asking only the students who rated highly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STORE_LINE, STORE_REVIEWS_URL, storeLineDue } from '../lib/storeReview.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const BASE = { answered: true, shownAt: 0, extensionInstalled: true, signedIn: true, onFocusScreen: true, sessionFinished: true };

test('whether the line shows never depends on the rating', async () => {
  for (const context of [BASE, { ...BASE, extensionInstalled: false }, { ...BASE, shownAt: 1 }]) {
    const results = [1, 2, 3, 4, 5].map(rating => storeLineDue({ ...context, rating, stars: rating }));
    assert.equal(new Set(results).size, 1, `same answer for every rating: ${JSON.stringify(context)}`);
  }
  // The prompt renders the line once, outside the high/low branches, with no rating passed in.
  const prompt = await read('../components/ReviewPrompt.js');
  assert.match(prompt, /\{stars > 0 && <StoreReviewLine sessionFinished=\{sessionFinished\} \/>\}\n\s*<\/section>/);
  assert.doesNotMatch(prompt, /chromewebstore|EXTENSION_STORE_URL|STORE_REVIEWS_URL|Leave a review/, 'no store ask only in the high-rating branch');
  const line = await read('../components/StoreReviewLine.js');
  const code = line.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.match(code, /export default function StoreReviewLine\(\{ sessionFinished = false \}\)/);
  assert.doesNotMatch(code, /stars|rating/i, 'the line never sees the rating');
  assert.match(code, /\{STORE_LINE\}/);
});

test('the line is shown at most once per account', async () => {
  assert.equal(storeLineDue(BASE), true);
  assert.equal(storeLineDue({ ...BASE, shownAt: Date.parse('2026-11-01T00:00:00Z') }), false);
  const line = await read('../components/StoreReviewLine.js');
  assert.match(line, /shownAt: getProgress\(\)\.storeLine/);
  assert.match(line, /updateProgress\(\(\) => \(\{ storeLine: Date\.now\(\) \}\)\)/, 'marked as shown when it appears');
  // Saved on the account (Supabase user metadata, lib/progress.js); once shown on any device, never again.
  const progress = await read('../lib/progress.js');
  assert.match(progress, /storeLine: 0/);
  assert.match(progress, /storeLine: Math\.max\(a\?\.storeLine \|\| 0, b\?\.storeLine \|\| 0\)/);
});

test('only for signed-in students with the extension, never mid-session in focus mode', () => {
  assert.equal(storeLineDue({ ...BASE, answered: false }), false, 'only after an answer');
  assert.equal(storeLineDue({ ...BASE, signedIn: false }), false, 'never to visitors');
  assert.equal(storeLineDue({ ...BASE, extensionInstalled: false }), false);
  assert.equal(storeLineDue({ ...BASE, sessionFinished: false }), false, 'not on a focus screen mid-session');
  assert.equal(storeLineDue({ ...BASE, onFocusScreen: false, sessionFinished: false }), true);
});

test('the wording and link are exactly as agreed, and the extension links to the same page', async () => {
  assert.equal(STORE_LINE, 'Using the Chrome extension? A review on the Chrome Web Store helps other students decide.');
  assert.equal(STORE_REVIEWS_URL, 'https://chromewebstore.google.com/detail/cordiaclassroom/eddmfjcnfjfbaknmeccjbjdgpeipjbaf/reviews');
  const popup = await read('../../extension/popup.html');
  assert.ok(popup.includes(`<a class="quiet-link" href="${STORE_REVIEWS_URL}" target="_blank" rel="noopener">Rate on Chrome Web Store</a>`));
  const manifest = JSON.parse(await read('../../extension/manifest.json'));
  assert.equal(manifest.version, '2.1.6');
});
