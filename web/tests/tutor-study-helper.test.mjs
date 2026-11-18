// The Tutor as a study helper (feedback F6): a study plan's buttons, the check-in in Learn, and the
// way back to the Tutor. The plan itself is worked out in backend services/study_helper.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const actions = read('components/StudyPlanActions.js');
const learn = read('pages/learn/[guideId].js');

test('a reply with a study plan shows its buttons, in every Tutor (panel, page and chat home)', () => {
  assert.match(read('components/TutorMessages.js'), /message\.study_plan && <StudyPlanActions plan=\{message\.study_plan\} tutor=\{tutor\}/);
});

test('the plan buttons only go to pages inside the app and reuse the existing Tutor and review-set paths', () => {
  assert.match(actions, /href\.startsWith\('\/'\) && !href\.startsWith\('\/\/'\)/);
  assert.match(actions, /cordia:tutor-prompt/);
  assert.match(actions, /\/plans\/\$\{encodeURIComponent\(action\.item_key\)\}\/review-set/);
  assert.doesNotMatch(actions, /fetch\(/); // apiFetch only: one Tutor client
});

test('the plan buttons use tokens and rem only, and keep their width while working', () => {
  for (const source of [actions]) {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    assert.doesNotMatch(source, /font[^;]*\d+px/);
  }
  assert.match(actions, /\.is-busy \.plan-face \{ visibility: hidden; \}/);
  assert.match(learn, /\.learn-back-tutor\.is-busy \.learn-back-face \{ visibility: hidden; \}/);
});

test('the Tutor gets the student\'s own day, so "Friday" means their Friday', () => {
  assert.match(read('lib/useTutorChat.js'), /local_date: localDay\(\)/);
});

test('Learn runs the check-in once, sends the score back, and returns to the same conversation', () => {
  assert.match(learn, /router\.query\.checkin === '1' && list\.length && !guide\?\.viewer && !checkinSeen\.current/);
  assert.match(learn, /apiFetch\('\/tutor\/session\/checkin'/);
  assert.match(learn, /delete query\.checkin/);
  assert.match(learn, /sessionStorage\.setItem\('cordiaTutorKeep', '1'\)/);
});
