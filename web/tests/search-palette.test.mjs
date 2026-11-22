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

test('owned ids come from the library, the sets it was copied from and the own rows', () => {
  const ids = ownedGuideIds([{ id: 'a' }, { id: 'b', forked_from_guide_id: 'c' }, null], [{ kind: 'guide', id: 'd' }, { kind: 'card', id: 'e' }, { kind: 'note', id: 'n' }]);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(ownedGuideIds(undefined, undefined).size, 0);
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
  assert.match(search, /publicSetRows\(publicHits, query, ownedGuideIds\(/);
  assert.doesNotMatch(search, /transition: all/);
  assert.doesNotMatch(search, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'colours come from tokens.css');
});
