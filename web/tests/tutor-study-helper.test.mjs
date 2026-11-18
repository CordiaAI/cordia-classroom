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
  assert.match(actions, /\.is-marked \.plan-face \{ visibility: hidden; \}/);
  assert.match(learn, /\.learn-back-tutor\.is-marked \.learn-back-face \{ visibility: hidden; \}/);
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

// ---- F6 review follow-up (F6b): findings 7, 8, 10, 12, 14 and 16 ----

const style = source => [...source.matchAll(/<style jsx(?: global)?>\{`([\s\S]*?)`\}<\/style>/g)].map(match => match[1]).join('\n');
const checkinRules = () => style(learn).split('\n').filter(line => /learn-checkin|learn-back/.test(line)).join('\n');

test('with reduced motion the working mark still shows: the 300ms wait is a timer, not an animation delay', () => {
  const loader = read('components/CordiaLoader.js');
  assert.match(loader, /const MARK_AFTER = 300;/);
  assert.match(loader, /const MARK_HOLD = 500;/);
  assert.match(loader, /export function useWorkingMark\(active\)/);
  for (const source of [actions, learn]) {
    assert.match(source, /useWorkingMark\(/);
    assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  }
  assert.match(style(actions), /\.is-marked \.plan-face \{[^}]*visibility: hidden/);
  assert.match(style(actions), /\.is-marked \.plan-spinner \{[^}]*opacity: 1/);
  assert.match(checkinRules(), /\.is-marked \.learn-back-face \{[^}]*visibility: hidden/);
  assert.doesNotMatch(style(actions) + checkinRules(), /animation: [\w-]+ [^;]*300ms/);
});

test("the check-in's status line sits on the Learn card, not on the bare backdrop", () => {
  const checkpoint = learn.slice(learn.indexOf("screen === 'checkpoint'"));
  const card = checkpoint.slice(0, checkpoint.indexOf('</section>'));
  assert.match(card, /learn-checkin-status/);
});

test('plan buttons and "Send it again" are 44px tap targets on touch screens and phones', () => {
  assert.match(style(actions), /@media \(max-width: 767px\), \(pointer: coarse\) \{[^}]*\.plan-btn\)[^}]*min-height: 2\.75rem !important/);
  assert.match(checkinRules() + style(learn), /@media \(max-width: 767px\), \(pointer: coarse\) \{[^}]*\.learn-checkin-again[^}]*min-height: 2\.75rem !important/);
  assert.match(learn, /className="c-btn c-btn--quiet c-btn--sm learn-checkin-again"/);
});

test('the new plan and check-in rules use tokens and rem, never px', () => {
  // Breakpoints in @media conditions and comments aside.
  const rules = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media \([^{]*\{/g, '');
  assert.doesNotMatch(rules(style(actions)), /\d+px/);
  assert.doesNotMatch(rules(checkinRules()), /\d+px/);
});

test('Overview is a quiet button next to the check-in\'s two actions', () => {
  assert.match(learn, /className=\{'c-btn c-btn--lg ' \+ \(checkinShown \? 'c-btn--quiet' : 'c-btn--secondary'\)\} onClick=\{\(\) => setScreen\('home'\)\}>Overview/);
});

test('a resumed ordinary round is never reported as the check-in', () => {
  assert.match(learn, /writeResume\('learn', guideId, \{[^}]*checkin: checkin === 'running'/);
  assert.match(learn, /setCheckin\(resumable && pending\.checkin \? 'running' : 'pending'\)/);
  assert.match(learn, /if \(checkin === 'pending'\) setCheckin\('running'\)/);
});
