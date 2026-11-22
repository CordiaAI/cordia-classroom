// Discover (Stage 7): the /explore address and the search panel's "Public sets" group.
import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySetsCopy, explorePath, isSetList, narrowing, publicSetRows, studiedBy, suggestionGroups } from '../lib/discover.mjs';

test('explore addresses carry the query, the tab and only the filters that are set', () => {
  assert.equal(explorePath(''), '/explore');
  assert.equal(explorePath('  cell membrane '), '/explore?q=cell+membrane');
  assert.equal(explorePath('osmosis', { tab: 'people' }), '/explore?q=osmosis&tab=people');
  assert.equal(explorePath('osmosis', { tab: 'guides', course: 'c1', size: '', from_my_classrooms: false }), '/explore?q=osmosis&course=c1');
  assert.equal(explorePath('x', { tab: 'nope', term: 'Fall 2026' }), '/explore?q=x&term=Fall+2026');
});

test('the search panel shows at most three public sets, then See all in Discover', () => {
  const guides = [1, 2, 3, 4].map(n => ({ id: 'g' + n, title: 'Set ' + n, studied_by: n === 1 ? 0 : n, author: { display_name: 'A classmate' } }));
  const rows = publicSetRows(guides, 'osmosis');
  assert.deepEqual(rows.map(row => row.kind), ['public', 'public', 'public', 'explore']);
  assert.equal(rows[0].href, '/sets/g1');
  assert.equal(rows[0].meta, 'A classmate');
  assert.equal(rows[1].meta, 'Studied by 2');
  assert.equal(rows[3].href, '/explore?q=osmosis');
  assert.equal(rows[0].verified, false);
  assert.equal(publicSetRows([{ id: 'v', title: 'By an instructor', verified: true }], 'cells')[0].verified, true, 'verified instructors get the badge');
  assert.deepEqual(publicSetRows(guides, '  '), []);
  assert.deepEqual(publicSetRows(null, 'osmosis').map(row => row.kind), ['explore']);
});

test('studied by reads plainly', () => {
  assert.equal(studiedBy(0), '');
  assert.equal(studiedBy(1), 'Studied by 1');
  assert.equal(studiedBy('12'), 'Studied by 12');
});

test('narrowing is a search or any filter, nothing else', () => {
  assert.equal(narrowing('', {}), false);
  assert.equal(narrowing('  ', { school: '', course: '', from_my_classrooms: false }), false);
  assert.equal(narrowing('osmosis', {}), true);
  assert.equal(narrowing('', { size: 'short' }), true);
  assert.equal(narrowing('', { from_my_classrooms: 'true' }), true);
  assert.equal(narrowing('', { tab: 'guides' }), false, 'a tab is not a filter');
});

test('an empty list of sets says one short sentence and offers one action', () => {
  const search = emptySetsCopy(' zebra ', { school: 's1' });
  assert.deepEqual(search, { message: 'No public sets match “zebra”.', action: 'clear', label: 'Clear search' });
  const filtered = emptySetsCopy('', { term: 'Fall 2026' });
  assert.deepEqual(filtered, { message: 'No public sets match these filters.', action: 'clear', label: 'Clear filters' });
  const none = emptySetsCopy('', {});
  assert.deepEqual(none, { message: 'Sets that students share publicly show up here.', action: 'library', label: 'Open your library' });
  for (const copy of [search, filtered, none]) {
    assert.ok(!copy.message.includes('!') && !copy.label.includes('!'), 'no exclamation marks');
    assert.equal(copy.message.split(/[.?!](?:\s|$)/).filter(Boolean).length, 1, 'one sentence');
  }
});

test('an empty search is filled with popular sets, then classmates\' sets, each shown once', () => {
  const set = (id, title) => ({ id, title });
  const popular = ['a', 'b', 'c', 'd', 'e'].map(id => set(id, 'Set ' + id));
  const classmates = [set('b', 'Set b'), set('x', 'Set x'), set('y', 'Set y')];
  const groups = suggestionGroups({ popular, classmates });
  assert.deepEqual(groups.map(group => group.key), ['popular', 'classmates']);
  assert.deepEqual(groups[0].sets.map(item => item.id), ['a', 'b', 'c', 'd'], 'popular first, at most four');
  assert.deepEqual(groups[1].sets.map(item => item.id), ['x', 'y'], 'a set already under Popular is not repeated');
  assert.deepEqual(groups.map(group => group.title), ['Popular public sets', 'From your classmates']);
});

test('a group with nothing in it, or a failed load, is left out', () => {
  assert.deepEqual(suggestionGroups({ popular: [], classmates: [] }), []);
  assert.deepEqual(suggestionGroups({ popular: null, classmates: undefined }), []);
  assert.deepEqual(suggestionGroups(), []);
  assert.deepEqual(suggestionGroups({ popular: [{ id: 'a', title: 'A' }], classmates: null }).map(group => group.key), ['popular']);
  assert.deepEqual(suggestionGroups({ popular: [{ id: 'a' }, { title: 'no id' }, null] })[0].sets, [{ id: 'a' }]);
});

test('only a list of sets is a result; null and error bodies are failures', () => {
  assert.equal(isSetList({ guides: [], total: 0 }), true);
  assert.equal(isSetList(null), false);
  assert.equal(isSetList({ detail: 'Internal Server Error' }), false);
  assert.equal(isSetList({ failed: 'network' }), false);
});
