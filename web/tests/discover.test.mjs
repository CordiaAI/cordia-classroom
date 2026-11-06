// Discover (Stage 7): the /explore address and the search panel's "Public sets" group.
import assert from 'node:assert/strict';
import test from 'node:test';
import { explorePath, publicSetRows, studiedBy } from '../lib/discover.mjs';

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
  assert.deepEqual(publicSetRows(guides, '  '), []);
  assert.deepEqual(publicSetRows(null, 'osmosis').map(row => row.kind), ['explore']);
});

test('studied by reads plainly', () => {
  assert.equal(studiedBy(0), '');
  assert.equal(studiedBy(1), 'Studied by 1');
  assert.equal(studiedBy('12'), 'Studied by 12');
});
