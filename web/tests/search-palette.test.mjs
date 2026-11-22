import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ownedGuideIds, searchRows, uniqueRows } from '../lib/searchResults.mjs';
import { publicSetRows } from '../lib/discover.mjs';

const source = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

// Discover lists public sets from everyone, the student included: their own published guide, or a
// set they copied, came back under Public sets after it already showed under Guides.
test('a guide the student owns, or copied, never shows again under Public sets', () => {
  const own = searchRows([
    { kind: 'study_guide', id: 'mine', title: 'Cell biology' },
    { kind: 'flashcard', id: 'carded', title: 'Osmosis', snippet: 'What moves water? — Osmosis', card_index: 2 },
    { kind: 'study_guide', id: 'copy', title: 'Membranes' },
  ]);
  const library = [
    { id: 'mine', title: 'Cell biology' },
    { id: 'copy', title: 'Membranes', forked_from_guide_id: 'original' },
  ];
  const discover = [
    { id: 'mine', title: 'Cell biology' },        // the student's own guide, published
    { id: 'original', title: 'Membranes' },       // the set they copied
    { id: 'carded', title: 'Osmosis' },           // a guide whose card matched
    { id: 'other1', title: 'Cell biology' },      // someone else's set with the same name stays
    { id: 'other2', title: 'Cell transport' },
    { id: 'other2', title: 'Cell transport' },    // the same set twice from Discover
    { id: 'other3', title: 'Cell signalling' },
    { id: 'other4', title: 'Cell cycle' },
  ];
  const rows = publicSetRows(discover, 'cell', ownedGuideIds(library, own));
  assert.deepEqual(rows.map(row => row.id || row.kind), ['other1', 'other2', 'other3', 'explore']);
  // Three still show after the student's own are left out.
  assert.equal(rows.filter(row => row.kind === 'public').length, 3);
});

test('an id is dropped only when its row is listed: the listed rows, and the sets listed guides were copied from', () => {
  const ids = ownedGuideIds(
    [{ id: 'a' }, { id: 'b', forked_from_guide_id: 'c' }, { id: 'f', forked_from_guide_id: 'g' }, null],
    [{ kind: 'guide', id: 'b' }, { kind: 'guide', id: 'd' }, { kind: 'card', id: 'e' }, { kind: 'note', id: 'n' }],
  );
  // 'a' is in the library but not listed, and 'f' (a copy of 'g') did not match: neither hides a public set.
  assert.deepEqual([...ids].sort(), ['b', 'c', 'd', 'e']);
  assert.equal(ownedGuideIds(undefined, undefined).size, 0);
  const rows = publicSetRows([{ id: 'a', title: 'Mine, not matched' }, { id: 'g', title: 'The original' }], 'x', ids);
  assert.deepEqual(rows.map(row => row.id || row.kind), ['a', 'g', 'explore']);
});

test('each row shows once, by its stable key, in order', () => {
  const rows = uniqueRows([{ key: 'g1', title: 'A' }, { key: 'g2', title: 'B' }, { key: 'g1', title: 'A again' }, { title: 'no key' }, null]);
  assert.deepEqual(rows.map(row => row.title), ['A', 'B']);
  // The shared search never lists the same hit twice either.
  const found = searchRows([
    { kind: 'study_guide', id: 'g1', title: 'Cells' },
    { kind: 'study_guide', id: 'g1', title: 'Cells' },
    { kind: 'flashcard', id: 'g1', title: 'Cells', snippet: 'A — B', card_index: 0 },
    { kind: 'flashcard', id: 'g1', title: 'Cells', snippet: 'C — D', card_index: 1 },
  ]);
  assert.deepEqual(found.map(row => row.key), ['guideg1:', 'cardg1:0', 'cardg1:1']);
});

test('the palette is a glass pill over a separate glass results bubble 8px below, with the app focus ring from the keyboard', async () => {
  const search = await source('components/SearchModal.js');
  assert.match(search, /'search-pill' \+ \(ringed/);
  assert.match(search, /className="search-bubble"/);
  assert.match(search, /\.c-search-palette \{ display: grid; gap: 8px;/);
  assert.match(search, /backdrop-filter: var\(--glass-blur\)/);
  assert.match(search, /background: var\(--glass-sheen\), var\(--glass-fill-strong\)/);
  // No ring while the field is simply open and typed in; the app's own ring when the keyboard brings focus back.
  assert.match(search, /\.search-pill\.is-ringed \{ outline: 2px solid var\(--focus-ring\); outline-offset: 2px; \}/);
  assert.match(search, /onFocus=\{\(\) => setRinged\(tabbedRef\.current\)\}/);
  // Listbox semantics, with the field pointing at the active option.
  assert.match(search, /role="listbox"/);
  assert.match(search, /role="option"/);
  assert.match(search, /aria-activedescendant=/);
  // Public sets are asked for with the student's own ids, and every list goes through uniqueRows.
  assert.match(search, /publicSetRows\(publicGuides, query, ownedGuideIds\(/);
  assert.doesNotMatch(search, /transition: all/);
  assert.doesNotMatch(search, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'colours come from tokens.css');
});

const css = async () => (await source('components/SearchModal.js')).match(/<style jsx>\{`([\s\S]*?)`\}<\/style>/)[1];

test('a search that cannot be reached says so with a Retry, keeps the last list, and never claims nothing matches', async () => {
  const search = await source('components/SearchModal.js');
  // No answer at all (not an empty one) is a failure: the shared search and the older search both came back without results.
  assert.match(search, /if \(!Array\.isArray\(data\?\.results\)\) \{ setFailed\(q\); return; \}/);
  assert.match(search, /"Search isn't reachable\. Try again\."/);
  assert.match(search, /className="c-btn c-btn--quiet search-retry" onClick=\{retry\}>Retry</);
  // The last answered list stays on screen while it is unreachable, and the "Nothing of yours" line needs an answer.
  assert.match(search, /const results = searching \|\| unreachable \? shownRef\.current\.rows : live;/);
  assert.match(search, /if \(!searching && !unreachable\) shownRef\.current/);
  assert.match(search, /status = unreachable \? .* : q && !ownCount \? \(searching \? 'Searching' : 'Nothing of yours matches'\)/);
  // Retry asks again and hands focus back to the field (its button goes away).
  assert.match(search, /setRetries\(count => count \+ 1\);\s*inputRef\.current\?\.focus\(\)/);
  assert.match(search, /\}, \[query, retries\]\);/);
});

test('public sets show only under the query they were asked for', async () => {
  const search = await source('components/SearchModal.js');
  assert.match(search, /setPublicHits\(\{ q, guides: Array\.isArray\(data\?\.guides\) \? data\.guides : \[\] \}\)/);
  assert.match(search, /const publicGuides = publicHits\.q === query\.trim\(\) \? publicHits\.guides : \[\];/);
  assert.doesNotMatch(search, /publicSetRows\(publicHits,/);
});

test('Escape works from anywhere, Tab stays inside the dialog, and a press on a heading keeps focus in the field', async () => {
  const search = await source('components/SearchModal.js');
  assert.match(search, /document\.addEventListener\('keydown', onKey, true\)/);
  assert.match(search, /event\.key === 'Escape' && !event\.isComposing\) \{ event\.stopPropagation\(\); closeRef\.current\(\)/);
  assert.match(search, /!box\.contains\(at\)/);
  assert.match(search, /event\.shiftKey && at === first\) \{ event\.preventDefault\(\); last\.focus\(\)/);
  assert.match(search, /!event\.shiftKey && at === last\) \{ event\.preventDefault\(\); first\.focus\(\)/);
  assert.match(search, /onMouseDown=\{event => \{ if \(!event\.target\.closest\('input, button'\)\) event\.preventDefault\(\); \}\}/);
  // The ring from the keyboard is cleared by any mouse press.
  assert.match(search, /addEventListener\('pointerdown', onPointer, true\)/);
  assert.match(search, /const onPointer = \(\) => \{ tabbedRef\.current = false; \};/);
});

test('the listbox holds labelled groups of options, and the click is on the option itself', async () => {
  const search = await source('components/SearchModal.js');
  assert.match(search, /role="group" aria-labelledby=\{label \? labelId : undefined\}/);
  assert.match(search, /id=\{labelId\} className="c-meta c-search-group"/);
  assert.match(search, /role="option" aria-selected=\{index === active\}/);
  assert.match(search, /onClick=\{\(\) => go\(result\)\}/);
  assert.doesNotMatch(search, /<button[^>]*c-search-hit/, 'no focusable button inside an option');
  assert.doesNotMatch(search, /<li\b/);
  // The field still points at an option id that exists.
  assert.match(search, /aria-activedescendant=\{results\[active\] \? optionId\(active\) : undefined\}/);
  assert.match(search, /id=\{optionId\(index\)\}/);
});

test('recent items stay on screen until the first answer arrives', async () => {
  const search = await source('components/SearchModal.js');
  assert.doesNotMatch(search, /shownRef\.current\.query \? shownRef\.current\.rows : \[\]/);
  // Enter does not open one of them while a typed query is still out.
  assert.match(search, /if \(searching && !shownRef\.current\.query\) return;/);
});

test('the library is loaded again each time Search opens, and a failed load keeps the last copy', async () => {
  const search = await source('components/SearchModal.js');
  assert.doesNotMatch(search, /if \(!cache\) \{/);
  assert.match(search, /if \(!Array\.isArray\(guides\?\.guides\) && !Array\.isArray\(notes\?\.notes\)\) return;/);
});

// Contrast of two colours the way WCAG states it.
function channels(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  return value.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
}
const over = ([r, g, b, a = 1], under) => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
const lum = color => { const [r, g, b] = color.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the active row ring is 3:1 or better on the results glass in light, dark and Paper & Clay', async () => {
  const styles = await css();
  assert.match(styles, /\.c-search-hit\.is-active \{ box-shadow: inset 0 0 0 2px var\(--focus-ring\); \}/);
  const tokens = await source('styles/tokens.css');
  const get = (block, name) => { const m = block.match(new RegExp(`${name}:\\s*([^;]+);`)); assert.ok(m, `missing ${name}`); return m[1].trim(); };
  const dark = tokens.indexOf("[data-theme='dark'] {");
  const light = tokens.slice(tokens.indexOf(':root {'), dark);
  const night = tokens.slice(dark, tokens.indexOf('}', dark));
  const clay = tokens.slice(tokens.indexOf(":root[data-look='paper-clay'] {"));
  const clayNight = tokens.slice(tokens.indexOf("[data-theme='dark'][data-look='paper-clay'] {"));
  const accent = (name, block) => `rgb(${get(block, name)})`;
  const looks = {
    light: { ring: channels(get(light, '--focus-ring')), canvas: channels(get(light, '--canvas')), fill: channels(get(light, '--glass-fill-strong')) },
    dark: { ring: channels(get(night, '--focus-ring')), canvas: channels(get(night, '--canvas')), fill: channels(get(night, '--glass-fill-strong')) },
    'paper and clay': {
      ring: channels(accent('--ca-l-ink', tokens.slice(tokens.indexOf(":root[data-look='paper-clay']:not([data-accent])")))),
      canvas: [255, 255, 255], fill: channels(get(clay, '--glass-fill-strong')),
    },
    'paper and clay dark': {
      ring: channels(accent('--ca-d-ink', tokens.slice(tokens.indexOf(":root[data-look='paper-clay']:not([data-accent])")))),
      canvas: [48, 48, 46], fill: channels(get(clayNight, '--glass-fill-strong')),
    },
  };
  for (const [name, { ring, canvas, fill }] of Object.entries(looks)) {
    assert.ok(ratio(ring, over(fill, canvas)) >= 3, `${name}: ring on the results glass`);
  }
});

test('the tour ring is not animated, so it never trails the cut-out', async () => {
  const spotlight = await source('components/Spotlight.js');
  const ring = spotlight.match(/\.spot-ring \{[^}]*\}/)[0];
  assert.doesNotMatch(ring, /transition/);
});
