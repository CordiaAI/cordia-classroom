// The app shell (docs/redesign/PLAN.md T2): the tool rail's tools and order, where each one goes,
// the one current place in the sidebar and the rail, Recent chats, and the sidebar's readiness rings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CLASSES, MORE_TOOL, MORE_TOOLS, RAIL_TOOLS, chatTitle, moreTools, pageGuideId, railCurrent, recentChats, sidebarCurrent, toolHref } from '../lib/shellTools.mjs';
import { classExams } from '../lib/examCountdown.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the rail lists the tools in the spec order, each with its one line, and More tools last', () => {
  assert.deepEqual(RAIL_TOOLS.map(tool => tool.label), ['Make guide', 'Learn', 'Flashcards', 'Quiz', 'Practice', 'Library', 'Calendar', 'Plan my week', 'Progress']);
  assert.equal(RAIL_TOOLS.find(tool => tool.key === 'learn').line, 'Master every idea before the test, one round at a time.');
  assert.equal(RAIL_TOOLS.find(tool => tool.key === 'week').line, 'Fit what’s due into the free time you have.');
  assert.equal(MORE_TOOL.line, 'Record a lecture, NCLEX practice, Study now, Dashboard and the Assistant.');
  for (const tool of RAIL_TOOLS) assert.ok(tool.line.length > 20 && tool.line.endsWith('.'), tool.key);
});

test('More tools holds every other tool from the feature map; NCLEX only with nursing material', () => {
  assert.deepEqual(MORE_TOOLS.map(item => item.label), ['New', 'Write cards', 'Record lecture', 'NCLEX', 'Study now', 'Dashboard', 'Assistant']);
  assert.ok(!moreTools().some(item => item.key === 'nclex'));
  assert.ok(moreTools({ nursing: true }).some(item => item.key === 'nclex'));
  assert.equal(toolHref('write'), '/create');
  assert.equal(toolHref('study'), '/session');
  assert.equal(toolHref('dashboard'), '/dashboard');
  assert.equal(toolHref('assistant'), '/assistant');
});

test('a tool opens on the guide the page is about, otherwise where a set is picked for it', () => {
  const guide = { id: 'g-cell-biology' };
  assert.equal(pageGuideId('/guide/[id]', guide), 'g-cell-biology');
  assert.equal(pageGuideId('/flashcards/study', { guideId: 'g-ethics' }), 'g-ethics');
  assert.equal(toolHref('learn', '/guide/[id]', guide), '/learn/g-cell-biology');
  assert.equal(toolHref('quiz', '/learn/[guideId]', { guideId: 'g-ethics' }), '/quiz/g-ethics');
  assert.equal(toolHref('flashcards', '/guide/[id]', guide), '/flashcards/study?guideId=g-cell-biology');
  assert.equal(toolHref('practice', '/guide/[id]', guide), '/practice/g-cell-biology');
  assert.equal(toolHref('learn', '/dashboard'), '/library?filter=learn');
  assert.equal(toolHref('flashcards', '/calendar'), '/library?filter=flashcards');
  assert.equal(toolHref('practice', '/library'), '/practice');
  assert.equal(toolHref('week'), '/week');
  assert.equal(toolHref('make'), null);
});

test('at most one rail button is current, and pages under More tools mark More tools', () => {
  assert.equal(railCurrent('/learn/[guideId]'), 'learn');
  assert.equal(railCurrent('/guide/[id]'), 'library');
  assert.equal(railCurrent('/library'), 'library');
  assert.equal(railCurrent('/week'), 'week');
  assert.equal(railCurrent('/dashboard'), 'more');
  assert.equal(railCurrent('/assistant'), 'more');
  assert.equal(railCurrent('/settings'), '');
  assert.equal(railCurrent('/folder/[id]'), '');
});

test('one sidebar item is current: the class, the open chat or New chat, or the account', () => {
  const classIds = ['c-ma125', 'c-bus101'];
  assert.equal(sidebarCurrent('/folder/[id]', { id: 'c-bus101' }, { classIds }), 'class:c-bus101');
  assert.equal(sidebarCurrent('/folder/[id]', { id: 'c-eh101' }, { classIds }), '');
  assert.equal(sidebarCurrent('/tutor', {}, { liveChat: false }), 'new');
  assert.equal(sidebarCurrent('/tutor', {}, { liveChat: true }), 'chat:live');
  assert.equal(sidebarCurrent('/settings'), 'account');
  assert.equal(sidebarCurrent('/library'), '');
  assert.equal(MAX_CLASSES, 5);
});

test('Recent chats: the open conversation first, then saved chats, newest first', () => {
  const live = [{ role: 'user', text: '  Why does   the chain rule work?' }, { role: 'assistant', text: 'Because…' }];
  const saved = [{ id: 'chat-2', title: 'Career portfolio outline' }, { id: 'chat-1', title: '' }];
  const chats = recentChats(live, saved);
  assert.deepEqual(chats.map(chat => chat.title), ['Why does the chain rule work?', 'Career portfolio outline', 'Tutor chat']);
  assert.equal(chats[0].href, '/tutor');
  assert.equal(chats[1].href, '/tutor?chat=chat-2');
  assert.deepEqual(recentChats([], saved).map(chat => chat.key), ['chat:chat-2', 'chat:chat-1']);
  assert.equal(chatTitle([{ role: 'user', text: 'x'.repeat(100) }]).length, 78);
});

test('a class shows readiness only for an exam in the next 14 days that has a review set', () => {
  const today = '2026-11-16';
  const guides = [
    { id: 'g-review', title: 'Exam 3: review', folder_id: 'c-ma125' },
    { id: 'g-notes', title: 'Related rates', folder_id: 'c-ma125' },
    { id: 'g-paced', title: 'Career portfolio', folder_id: 'c-bus101', flashcard_progress: { learn: { test_date: '2026-11-20' } } },
    { id: 'g-late', title: 'Final: review', folder_id: 'c-eh101' },
  ];
  const exams = [
    { title: 'Exam 3', type: 'exam', due_at: '2026-11-19T15:00:00Z' },
    { title: 'Final', type: 'exam', due_at: '2026-12-15T15:00:00Z' },
  ];
  const found = classExams(['c-ma125', 'c-bus101', 'c-eh101', 'c-cis115'], guides, exams, today);
  assert.deepEqual(Object.keys(found).sort(), ['c-bus101', 'c-ma125']);
  assert.equal(found['c-ma125'].guideId, 'g-review');
  assert.equal(found['c-bus101'].guideId, 'g-paced');
});

test('the shell wiring: the sidebar has no tools, the rail is mounted, popovers are real tooltips', () => {
  const sidebar = read('components/Sidebar.js');
  const rail = read('components/ToolRail.js');
  const tips = read('components/ShellTips.js');
  assert.match(read('components/Layout.js'), /<\/main>\s*<ToolRail \/>/);
  assert.doesNotMatch(sidebar, /<ToolRail/);
  assert.match(sidebar, /aria-label="New chat"/);
  assert.match(sidebar, /readiness for the next exam|ready for the next exam/);
  assert.match(rail, /'aria-describedby': tipId\(tool\.key\)/);
  assert.match(rail, /aria-haspopup="menu"/);
  assert.match(tips, /role=\{describes \? 'tooltip' : undefined\}/);
  assert.match(tips, /HOVER_DELAY = 300/);
  // The readiness % is Learn's own: one copy of the question list, shared with the Dashboard.
  assert.match(read('pages/dashboard.js'), /learnQuestions, nearestExam \} from '\.\.\/lib\/examCountdown\.mjs'/);
  assert.doesNotMatch(read('pages/dashboard.js'), /function learnQuestions/);
});
