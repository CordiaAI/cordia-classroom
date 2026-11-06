// What's new (lib/featureReleases.js): who sees which feature, the Dashboard card's order, the
// Help list, the pointer tip's page, and visits that count as use.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const source = readFileSync(join(web, 'lib/featureReleases.js'), 'utf8');
const lib = await import('data:text/javascript,' + encodeURIComponent(source));
const { FEATURE_RELEASES, FOCUS_ROUTES, available, eligible, helpList, matchesAudience, nextAnnouncement, tipForPage, unseenCount, usedOnPage } = lib;

const TODAY = '2026-11-20';
const release = (id, releasedAt, extra = {}) => ({ id, title: id, description: '', releasedAt, where: { route: '/x', anchor: '#x' }, audience: 'all', flag: null, ...extra });
const RELEASES = [
  release('b', '2026-11-05'),
  release('a', '2026-10-28'),
  release('pro-only', '2026-10-30', { audience: 'pro' }),
  release('flagged', '2026-10-29', { flag: 'DISCOVER' }),
  release('future', '2026-12-01'),
];
const OLD = { createdAt: '2026-09-01T00:00:00Z', plan: 'free', canvas: false, nursing: false };
const NONE = { announced: [], opened: [], dismissed: [] };

test('only students who joined before the release are announced to', () => {
  assert.equal(eligible(RELEASES[1], OLD, NONE, {}, TODAY), true);
  assert.equal(eligible(RELEASES[1], { ...OLD, createdAt: '2026-10-28T12:00:00Z' }, NONE, {}, TODAY), false, 'joined on release day');
  assert.equal(eligible(RELEASES[1], { ...OLD, createdAt: '2026-11-01T00:00:00Z' }, NONE, {}, TODAY), false, 'joined after');
  assert.equal(eligible(RELEASES[1], { ...OLD, createdAt: null }, NONE, {}, TODAY), false, 'unknown join date');
  assert.equal(eligible(RELEASES[4], OLD, NONE, {}, TODAY), false, 'not released yet');
});

test('audience: all, Canvas-connected, nursing, Pro and free', () => {
  const r = audience => release('r', '2026-10-01', { audience });
  assert.equal(matchesAudience(r('all'), OLD), true);
  assert.equal(matchesAudience(r('canvas-connected'), OLD), false);
  assert.equal(matchesAudience(r('canvas-connected'), { ...OLD, canvas: true }), true);
  assert.equal(matchesAudience(r('nursing'), { ...OLD, nursing: true }), true);
  assert.equal(matchesAudience(r('pro'), OLD), false);
  assert.equal(matchesAudience(r('pro'), { ...OLD, plan: 'pro' }), true);
  assert.equal(matchesAudience(r('free'), { ...OLD, plan: 'pro' }), false);
  assert.equal(matchesAudience(r('free'), OLD), true);
  assert.equal(matchesAudience(r('someone-else'), OLD), false);
});

test('a feature behind a flag waits for it', () => {
  assert.equal(eligible(RELEASES[3], OLD, NONE, {}, TODAY), false);
  assert.equal(eligible(RELEASES[3], OLD, NONE, { DISCOVER: true }, TODAY), true);
  assert.equal(available(RELEASES[3], OLD, { DISCOVER: false }, TODAY), false);
});

test('dismissed or used features are never announced again', () => {
  assert.equal(eligible(RELEASES[1], OLD, { ...NONE, dismissed: ['a'] }, {}, TODAY), false);
  assert.equal(eligible(RELEASES[1], OLD, { ...NONE, opened: ['a'] }, {}, TODAY), false);
  assert.equal(eligible(RELEASES[1], OLD, { ...NONE, announced: ['a'] }, {}, TODAY), true, 'shown but not acted on: still eligible');
});

test('the Dashboard card goes oldest first and moves on as features are dismissed or used', () => {
  const flags = { DISCOVER: true };
  assert.equal(nextAnnouncement(RELEASES, OLD, NONE, flags, TODAY).id, 'a');
  assert.equal(nextAnnouncement(RELEASES, OLD, { ...NONE, dismissed: ['a'] }, flags, TODAY).id, 'flagged');
  assert.equal(nextAnnouncement(RELEASES, OLD, { ...NONE, dismissed: ['a'], opened: ['flagged'] }, flags, TODAY).id, 'b');
  assert.equal(nextAnnouncement(RELEASES, { ...OLD, plan: 'pro' }, { ...NONE, dismissed: ['a', 'flagged'] }, flags, TODAY).id, 'pro-only');
  assert.equal(nextAnnouncement(RELEASES, OLD, { ...NONE, dismissed: ['a', 'flagged', 'b'] }, flags, TODAY), null);
});

test('Help lists everything available, newest first, with a dot while unseen', () => {
  const list = helpList(RELEASES, OLD, { ...NONE, opened: ['b'] }, {}, TODAY);
  assert.deepEqual(list.map(item => item.id), ['b', 'a']);
  assert.deepEqual(list.map(item => item.unseen), [false, true]);
  assert.equal(unseenCount(RELEASES, OLD, { ...NONE, opened: ['b'] }, {}, TODAY), 1);
  // Someone who joined after everything still sees the list, with no dots.
  const newcomer = helpList(RELEASES, { ...OLD, createdAt: '2026-11-15T00:00:00Z' }, NONE, {}, TODAY);
  assert.deepEqual(newcomer.map(item => [item.id, item.unseen]), [['b', false], ['a', false]]);
});

test('pointer tips never on focus-mode study screens; visits count as use', () => {
  const guideRelease = release('g', '2026-10-01', { where: { route: 'guide', anchor: '[data-spot="learn-pill"]' }, usedOn: ['/learn/[guideId]'] });
  assert.equal(tipForPage([guideRelease], '/guide/[id]', OLD, NONE, {}, TODAY).id, 'g');
  assert.equal(tipForPage([guideRelease], '/library', OLD, NONE, {}, TODAY), null);
  for (const route of FOCUS_ROUTES) {
    assert.equal(tipForPage([release('f', '2026-10-01', { where: { route, anchor: '#x' } })], route, OLD, NONE, {}, TODAY), null, route);
  }
  assert.deepEqual(usedOnPage([guideRelease, release('x', '2026-10-01')], '/learn/[guideId]'), ['g']);
  assert.deepEqual(usedOnPage([release('x', '2026-10-01')], '/x'), ['x'], 'usedOn defaults to where.route');
});

test('the seeded registry is well formed', () => {
  const ids = new Set();
  for (const item of FEATURE_RELEASES) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.ok(!ids.has(item.id), 'unique id ' + item.id);
    ids.add(item.id);
    assert.ok(item.title.split(/\s+/).length <= 5, 'title is 5 words or fewer: ' + item.title);
    assert.match(item.releasedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['all', 'canvas-connected', 'nursing', 'pro', 'free'].includes(item.audience));
    assert.ok(item.description && item.description.length <= 120);
    assert.ok(item.where?.route);
  }
});
