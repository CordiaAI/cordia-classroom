import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classExam, classTabs, dueSoon, dueWhen, examWhen, gradeEstimate, guideMeta, isReviewSet, masteredLine, masteryParts,
  orderGuides, pickTab, sourceLabel, syncAgo, syncLine,
} from '../lib/classPage.mjs';
import { examPlan, guideTally, reviewSetFor } from '../lib/examCountdown.mjs';
import { readiness } from '../lib/learnEngine.mjs';

const source = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const TODAY = '2026-11-16';
const at = (day, time = '17:00:00') => new Date(`${day}T${time}`).toISOString();

// The class page in the new shell (docs/redesign/PLAN.md T7, DESIGN-SPEC 4.4).

test('tabs: Chats, Guides, Files, Deadlines, Grades; Files and Grades only for a Canvas class; Guides by default', () => {
  assert.deepEqual(classTabs(true).map(tab => tab.label), ['Chats', 'Guides', 'Files', 'Deadlines', 'Grades']);
  assert.deepEqual(classTabs(false).map(tab => tab.label), ['Chats', 'Guides', 'Deadlines']);
  assert.equal(pickTab('grades', true), 'grades');
  assert.equal(pickTab('grades', false), 'guides');
  assert.equal(pickTab('sets', true), 'guides');
  assert.equal(pickTab(undefined, true), 'guides');
});

test('a guide row says where it came from and how many ideas; the bar is Learn\'s own tally', () => {
  assert.equal(sourceLabel({ source_type: 'file', source_title: 'Week 4 - Related rates.pdf' }), 'PDF');
  assert.equal(sourceLabel({ source_type: 'file', source_title: 'Unit 3 Market Structures.pptx' }), 'Lecture slides');
  assert.equal(sourceLabel({ source_type: 'lecture' }), 'Lecture recording');
  assert.equal(sourceLabel({ source_type: 'canvas_module' }), 'Canvas module');
  assert.equal(guideMeta({ source_type: 'file', source_title: 'Baroque painting.pdf' }, { total: 18 }), 'PDF · 18 ideas');
  assert.equal(guideMeta({ title: 'Midterm: review' }, { total: 1 }), 'Review set · 1 idea');
  assert.equal(guideMeta({ source_type: 'webpage' }, null), 'Web page');
  const tally = { total: 24, new: 0, learning: 8, familiar: 7, mastered: 9, fading: 1 };
  assert.deepEqual(masteryParts(tally), [{ key: 'mastered', count: 9 }, { key: 'familiar', count: 7 }, { key: 'learning', count: 8 }]);
  assert.equal(masteredLine(tally), '9 of 24 mastered');
  assert.equal(masteredLine({ total: 0 }), '');
});

test('the review set for the exam leads the list; the rest stay newest first', () => {
  const guides = [
    { id: 'a', title: '4.1 Maximum and minimum values', created_at: '2026-11-10T10:00:00Z' },
    { id: 'b', title: 'Exam 3: review', created_at: '2026-11-01T10:00:00Z' },
    { id: 'c', title: '4.3 How derivatives affect a graph', created_at: '2026-11-12T10:00:00Z' },
  ];
  assert.deepEqual(orderGuides(guides, 'b').map(guide => guide.id), ['b', 'c', 'a']);
  assert.deepEqual(orderGuides(guides).map(guide => guide.id), ['c', 'a', 'b']);
  assert.equal(isReviewSet(guides[1]), true);
  assert.equal(isReviewSet(guides[0]), false);
  assert.equal(reviewSetFor(guides, 'Exam 3')?.id, 'b');
});

test('the exam card shows the class\'s next exam: its review set when it has one, its own Canvas exam otherwise', () => {
  const guides = [{ id: 'set', title: 'Exam 3: review' }, { id: 'g1', title: '3.9 Related rates' }];
  const exam3 = { id: 'canvas-9', title: 'Exam 3', type: 'exam', due_at: at('2026-11-19') };
  const found = classExam(guides, [exam3], ['canvas-9'], TODAY);
  assert.equal(found.title, 'Exam 3');
  assert.equal(found.date, '2026-11-19');
  assert.equal(found.daysLeft, 3);
  assert.equal(found.guideId, 'set');
  assert.equal(found.itemId, 'canvas-9');
  assert.equal(found.dueAt, exam3.due_at);

  // A Canvas exam of this class with no review set yet: the card offers to build one.
  const midterm = { id: 'canvas-7', title: 'Midterm', type: 'exam', due_at: at('2026-11-25') };
  const bare = classExam([{ id: 'g1', title: 'Supply and demand' }], [midterm], ['canvas-7'], TODAY);
  assert.equal(bare.guideId, '');
  assert.equal(bare.daysLeft, 9);

  // Another class's exam, a finished exam and a past one are not this class's next exam.
  assert.equal(classExam(guides, [{ ...midterm, id: 'canvas-other' }], ['canvas-9'], TODAY), null);
  assert.equal(classExam(guides, [{ ...exam3, done: true }], ['canvas-9'], TODAY), null);
  assert.equal(classExam(guides, [{ ...exam3, due_at: at('2026-11-10') }], ['canvas-9'], TODAY), null);
  assert.equal(classExam(guides, [], [], TODAY), null);
});

test('readiness, ideas left and today\'s pace come from Learn\'s own functions', async () => {
  const questions = Array.from({ length: 4 }, (_, index) => ({ question: `Which force keeps orbit ${index + 1} stable?`, options: ['Gravity', 'Friction', 'Magnetism', 'Tension'], correct_index: 0 }));
  const guide = { quiz_questions: questions, flashcard_progress: { learn: { levels: {} } } };
  const tally = guideTally(guide, TODAY);
  assert.equal(tally.total, 4);
  assert.equal(readiness(tally), 0);
  assert.deepEqual(examPlan(guide, '2026-11-19', TODAY), { daysLeft: 3, remaining: 4, perDay: 2, past: false });
  // The class page doesn't work any of it out a second way.
  const page = [await source('components/ClassProject.js'), await source('components/ClassExamCard.js'), await source('lib/classPage.mjs'), await source('lib/classPageData.js')].join('\n');
  assert.doesNotMatch(page, /mastered \+ |\* 0\.5|Math\.ceil\(remaining/);
  assert.match(page, /percent: readiness\(tally\), plan: testPlan\(tally, exam\.date, today\)/);
});

test('dates, times and the sync line read one way on the page', () => {
  assert.equal(examWhen({ date: '2026-11-19', dueAt: '2026-11-19T15:30:00.000Z', daysLeft: 3 }, 'en-US').split(' · ')[0], 'Thu, Nov 19');
  assert.match(examWhen({ date: '2026-11-19', dueAt: '2026-11-19T15:30:00.000Z', daysLeft: 3 }, 'en-US'), /^Thu, Nov 19 · \d{1,2}:30 (AM|PM) · in 3 days$/);
  assert.equal(examWhen({ date: '2026-11-17', daysLeft: 1 }, 'en-US'), 'Tue, Nov 17 · tomorrow');
  assert.match(dueWhen(at('2026-11-20', '23:59:00'), 'en-US'), /^Fri, Nov 20 · 11:59 PM$/);
  const now = new Date('2026-11-16T15:00:00Z').getTime();
  assert.equal(syncAgo('2026-11-16T14:48:00Z', now), '12 minutes ago');
  assert.equal(syncAgo('2026-11-16T14:59:00Z', now), '1 minute ago');
  assert.equal(syncAgo('2026-11-16T12:00:00Z', now), '3 hours ago');
  assert.equal(syncAgo('2026-11-16T14:59:50Z', now), 'just now');
  assert.equal(syncAgo('', now), '');
  assert.equal(syncLine('MA 125', '12 minutes ago'), 'MA 125 · synced from Canvas 12 minutes ago');
  assert.equal(syncLine('MA 125', ''), 'MA 125');
});

test('Due soon: the next three deadlines not done yet; the grade is an estimate from Canvas', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();
  const deadlines = [
    { id: 1, title: 'Homework 10', due_at: '2026-11-20T23:59:00Z' },
    { id: 2, title: 'Quiz 8', due_at: '2026-11-18T14:00:00Z' },
    { id: 3, title: 'Lab report', due_at: '2026-11-17T14:00:00Z', done: true },
    { id: 4, title: 'Reading response', due_at: '2026-11-10T14:00:00Z' },
    { id: 5, title: 'Project draft', due_at: '2026-11-24T14:00:00Z' },
    { id: 6, title: 'Final paper', due_at: '2026-12-04T14:00:00Z' },
  ];
  assert.deepEqual(dueSoon(deadlines, now).map(item => item.id), [2, 1, 5]);
  assert.deepEqual(gradeEstimate({ canvas_score: 88, canvas_letter: 'B' }), { percent: '88.0%', letter: 'B' });
  assert.deepEqual(gradeEstimate({ score: 87.46, letter: '' }), { percent: '87.5%', letter: '' });
  assert.equal(gradeEstimate({ score: null }), null);
  assert.equal(gradeEstimate(null), null);
});

test('the page: one switch picks today\'s page or the project page, with no flash of either', async () => {
  const page = await source('pages/folder/[id].js');
  assert.match(page, /const shell = useNewShell\(\);/);
  assert.match(page, /if \(shell === null\) return <LoadingArea/);
  assert.match(page, /shell \? <ClassProject \/> : <ClassPageLegacy \/>/);
  const layout = await source('components/Layout.js');
  assert.match(layout, /Boolean\(shell && router\.pathname === '\/folder\/\[id\]'\)/);
  const bubble = await source('components/TutorBubble.js');
  assert.match(bubble, /shell && router\.pathname === '\/folder\/\[id\]'/);
});

test('the class composer starts a saved chat in this class; the Chats tab reads the same saved chats', async () => {
  const project = await source('components/ClassProject.js');
  assert.match(project, /startChat\(\{ session, guideId: material\?\.kind === 'guide' \? material\.id : null, classId: classId \|\| null \}\)/);
  assert.match(project, /useTutorChat\(\{ freshOnSend: true, scopeClassId: classId, startWith: chat \? null : startNew/);
  // The picker defaults to this class (T4 criterion 3).
  assert.match(project, /const \[classId, setClassId\] = useState\(id\);/);
  assert.match(project, /onChatsChanged\(refresh\)/);
  assert.match(project, /href=\{chatHref\(row\.id\)\}/);
  assert.match(project, /Ask about this class above to start a chat\./);
  const data = await source('lib/classPageData.js');
  assert.match(data, /safe\(classChats\(folderId\)\)/);
  // Nothing reads the Tutor's chats a second way.
  assert.doesNotMatch(project + data, /tutor\/chats|loadSavedChats|classChatsFrom/);
});

test('every row and card on the class page has its ⋯ (F3): at the end, on hover and focus, always on touch', async () => {
  const project = await source('components/ClassProject.js');
  const sets = await source('components/ClassSets.js');
  const exam = await source('components/ClassExamCard.js');
  for (const label of ['guideMenu(guide)', 'otherMenu(item)', 'chatMenu(row)']) assert.match(project, new RegExp(`items=\\{${label.replace(/[()]/g, '\\$&')}\\} triggerClassName=\\{MORE\\}`));
  assert.match(project, /const MORE = 'c-icon-btn cls-more';/);
  assert.match(project, /label=\{`More for \$\{deadlineTitle\(item\)\}`\} triggerClassName=\{MORE\}/);
  assert.match(sets, /triggerClassName="c-icon-btn cls-more"[\s\S]*Report/);
  assert.match(sets, /\{ label: done \? 'Mark not done' : 'Mark done'/);
  assert.match(exam, /triggerClassName="c-icon-btn cls-more"/);
  assert.match(exam, /\.cls-exam-head > \.c-menu-wrap \{ position: absolute; top: -8px; right: -8px; \}/);
  assert.match(project, /\.cls-v2 \.cls-more \{ flex: none; opacity: 0;/);
  assert.match(project, /:focus-within \.cls-more, \.cls-v2 \.cls-more\[aria-expanded='true'\] \{ opacity: 1; \}/);
  assert.match(project, /@media \(hover: hover\) \{ \.cls-v2 :is\(\.cls-row, \.cp-row, \.cls-due-item, \.cls-exam\):hover \.cls-more \{ opacity: 1; \} \}/);
  assert.match(project, /@media \(hover: none\) \{\s+\.cls-v2 \.cls-more \{ position: relative; opacity: 1; \}\s+\.cls-v2 \.cls-more::after \{ content: ''; position: absolute; inset: -2px; \}/);
  // Mark done from Due soon can be undone.
  assert.match(project, /setToast\(\{ text: 'Marked done', undo: /);
  // Moving and deleting call the same functions as before (the move bug is fixed elsewhere).
  assert.match(project, /apiFetch\('\/guides\/' \+ guide\.id \+ '\/move', \{ method: 'PATCH'/);
  assert.match(project, /remove\(\{ id: guide\.id, title: guide\.title, also: note \}\)/);
});

test('"Yours" is a padded, centred chip; an unread guide shows its page icon, not an empty ring (F3)', async () => {
  const sets = await source('components/ClassSets.js');
  assert.match(sets, /<span className="cp-chip">Yours<\/span>/);
  assert.match(sets, /\.cp-chip \{ flex: none; display: inline-flex; align-items: center; align-self: center; height: 28px; padding: 0 12px;/);
  const legacy = await source('components/ClassPageLegacy.js');
  assert.match(legacy, /item\.progress > 0 \? <ProgressRing value=\{item\.progress\} size=\{36\} label=\{false\} \/> : <FileText \{\.\.\.ICON\} \/>/);
});

test('the mastery bar follows the accent, in light and dark', async () => {
  const tokens = await source('styles/tokens.css');
  assert.match(tokens, /--mastery-mastered: rgb\(var\(--accent-rgb\)\); --mastery-familiar: rgba\(var\(--accent-rgb\), 0\.45\); --mastery-learning: rgba\(var\(--accent-rgb\), 0\.16\);/);
  assert.match(tokens, /--mastery-mastered: rgb\(var\(--accent-tint-rgb\)\);/);
});
