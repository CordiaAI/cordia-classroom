// The MCP read tools against an in-memory stand-in for the student's Supabase client (RLS itself is
// tested on a real local stack: tests/oauth/probe.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as z from 'zod';
import { READ_TOOLS, READ_ONLY } from '../lib/mcp/readTools.mjs';
import { loadCourses } from '../lib/mcp/courses.mjs';
import { MAX_CHARS, decodeCursor } from '../lib/mcp/output.mjs';
import { localDay, zonedIso } from '../lib/mcp/zoned.mjs';

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fakeDb(tables, rpc = {}) {
  function query(name) {
    let rows = [...(tables[name] || [])];
    const sorts = [];
    let window = null;
    let single = false;
    let spec = '*';
    const builder = {
      select(columns) { spec = columns; return builder; },
      eq(column, value) { rows = rows.filter(row => row[column] === value); return builder; },
      neq(column, value) { rows = rows.filter(row => row[column] !== value); return builder; },
      in(column, values) { rows = rows.filter(row => values.includes(row[column])); return builder; },
      gte(column, value) { rows = rows.filter(row => String(row[column]) >= String(value)); return builder; },
      ilike(column, pattern) { const needle = pattern.replace(/%/g, '').toLowerCase(); rows = rows.filter(row => String(row[column] || '').toLowerCase().includes(needle)); return builder; },
      order(column, { ascending = true } = {}) { sorts.push([column, ascending ? 1 : -1]); return builder; },
      range(from, to) { window = [from, to + 1]; return builder; },
      limit(count) { window = [0, count]; return builder; },
      maybeSingle() { single = true; return builder; },
      then(resolve) {
        rows.sort((a, b) => { for (const [column, way] of sorts) { if (a[column] < b[column]) return -way; if (a[column] > b[column]) return way; } return 0; });
        if (window) rows = rows.slice(...window);
        const aliases = [...spec.matchAll(/(\w+):(\w+)->(\w+)/g)];
        const shaped = rows.map(row => { const out = { ...row }; for (const [, alias, column, key] of aliases) out[alias] = row[column]?.[key] ?? null; return out; });
        resolve({ data: single ? shaped[0] || null : shaped, error: null });
      },
    };
    return builder;
  }
  return { from: query, rpc: async (name, args) => (rpc[name] ? { data: rpc[name](args), error: null } : { data: null, error: { message: 'missing' } }) };
}

function context(tables, extra = {}) {
  const db = fakeDb(tables, extra.rpc);
  let courses = null;
  return {
    db,
    baseUrl: 'https://classroom.cordiacode.com',
    timeZone: extra.timeZone || 'America/Chicago',
    courses: () => courses || (courses = loadCourses(db)),
    fetchBackend: extra.fetchBackend || (async () => ({ ok: false, status: 500 })),
    load: async () => {},
  };
}

const tool = name => READ_TOOLS.find(item => item.name === name);
async function call(name, ctx, args = {}) {
  const definition = tool(name);
  const result = await definition.run(ctx, z.object(definition.input).strict().parse(args));
  if (!result.isError) {
    z.object(definition.output).parse(result.structuredContent);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent, 'text block mirrors structuredContent');
    assert.ok(result.content[0].text.length <= MAX_CHARS, `${name} stays under the size cap`);
  }
  return result;
}

const folders = [
  { id: U(101), lms_named: true, own_name: null, created_at: '2026-08-20T00:00:00Z' },
  { id: U(102), lms_named: false, own_name: 'My Spanish', created_at: '2026-08-21T00:00:00Z' },
  { id: U(103), lms_named: true, own_name: null, created_at: '2026-08-22T00:00:00Z' },
];
const guides = [
  { id: U(1), title: 'Cell biology', folder_id: U(101), created_at: '2026-10-30T15:00:00Z', source_type: 'file', notes: '> Cells\n## Organelles\n- The **mitochondria** makes ATP\n  - detail\n## Key points\n- ATP', study_guide: 'Q1: What makes ATP?\nA1: Mitochondria',
    flashcards: [{ front: 'What makes ATP?', back: 'Mitochondria' }, { front: 'Powerhouse?', back: 'Mitochondria', image: 'data:image/png;base64,AAA' }],
    flashcard_progress: { schedule: { 0: { box: 2, due: '2099-01-01' } } }, quiz_questions: [{ question: 'Q?', options: ['a', 'b'], correct_index: 1 }], practice_state: { problems: [{ prompt: 'Solve', answer: '4' }], progress: { evaluations: { 0: { status: 'correct' } } } } },
  { id: U(2), title: 'Module 3 page', folder_id: U(101), created_at: '2026-10-29T15:00:00Z', source_type: 'canvas_module', notes: '## Page\n- text', study_guide: '', flashcards: [], flashcard_progress: {}, quiz_questions: null, practice_state: null },
  { id: U(3), title: 'Verbos', folder_id: U(102), created_at: '2026-10-28T15:00:00Z', source_type: 'pasted_text', notes: '', study_guide: '', flashcards: [{ front: 'ser', back: 'to be' }], flashcard_progress: {}, quiz_questions: [], practice_state: null },
];
const tables = {
  folders,
  study_guides: guides,
  retain_misses: [{ guide_id: U(3), items: [{ question: 'Conjugate ir', answer: 'voy', sure: true }] }],
  learning_events: [{ guide_id: U(3), item_id: 'ser', outcome: 'wrong', confidence: 'think_so', occurred_at: '2026-10-29T10:00:00Z' }, { guide_id: U(3), item_id: 'ser', outcome: 'right', confidence: 'guess', occurred_at: '2026-10-20T10:00:00Z' }],
  lectures: [{ id: U(50), title: 'Lecture 4', folder_id: U(103), lecture_date: '2026-10-28', duration_ms: 3000000, created_at: '2026-10-28T18:00:00Z',
    analysis: { summary: ['Cells'], outline_md: '## Cells\n- parts', watch_for: [{ point: 'Know the parts', why: 'exam', quote: 'this is on the exam', at_ms: 95000 }], terms: [{ term: 'ATP', definition: 'energy', at_ms: 1000 }], questions: [{ question: 'Who knows?', at_ms: 2000 }], my_notes: 'ask about ATP' },
    segments: Array.from({ length: 300 }, (_, i) => ({ start_ms: i * 10000, text: `Segment ${i} `.repeat(20) })), transcript: '' }],
  lecture_todos: [{ lecture_id: U(50), title: 'Read chapter 5', kind: 'reading', due_at: '2026-11-03T23:59:00Z', at_ms: 90000, status: 'confirmed' }, { lecture_id: U(50), title: 'Skip', status: 'dismissed' }],
  generation_jobs: [{ id: U(70), status: 'done', progress: 1, study_set_id: U(1), error: null, updated_at: '2026-10-30T15:00:00Z' }],
  study_days: [],
  user_profiles: [],
};

test('every tool: title, read-only annotations, input limits, a 1–3 sentence description', () => {
  assert.deepEqual(READ_ONLY, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(READ_TOOLS.map(item => item.name), ['search_my_materials', 'list_study_sets', 'get_study_set', 'list_lectures', 'get_lecture', 'get_due_cards', 'get_progress', 'get_job_status']);
  for (const item of READ_TOOLS) {
    assert.match(item.name, /^[a-z_]+$/);
    assert.ok(item.title && item.output && item.run, item.name);
    const sentences = item.description.split(/(?<=\.)\s+(?=[A-Z])/).length;
    assert.ok(sentences >= 1 && sentences <= 3, `${item.name}: ${sentences} sentences`);
    assert.throws(() => z.object(item.input).strict().parse({ unexpected: 1 }), item.name);
  }
  assert.throws(() => z.object(tool('search_my_materials').input).parse({ query: 'x'.repeat(501) }));
  assert.throws(() => z.object(tool('get_due_cards').input).parse({ limit: 31 }));
  assert.throws(() => z.object(tool('get_study_set').input).parse({ study_set_id: 'not-an-id' }));
});

test('course labels: Canvas and calendar folders are "Course N" with example sets; the student\'s names stay', async () => {
  const courses = await loadCourses(fakeDb(tables));
  assert.deepEqual(courses.get(U(101)), { id: U(101), name: 'Course 1', example_study_sets: ['Cell biology', 'Module 3 page'] });
  assert.deepEqual(courses.get(U(102)), { id: U(102), name: 'My Spanish' });
  assert.deepEqual(courses.get(U(103)), { id: U(103), name: 'Course 2', example_study_sets: [] });
  assert.equal(courses.get(null), null);
});

test('dates come out in the student\'s time zone', () => {
  assert.equal(zonedIso('2026-10-30T15:04:05Z', 'America/Chicago'), '2026-10-30T10:04:05-05:00');
  assert.equal(zonedIso('2026-12-01T00:00:00Z', 'Asia/Kolkata'), '2026-12-01T05:30:00+05:30');
  assert.equal(zonedIso('2026-10-30T15:04:05Z', 'UTC'), '2026-10-30T15:04:05+00:00');
  assert.equal(localDay(new Date('2026-10-31T03:00:00Z'), 'America/Chicago'), '2026-10-30');
  assert.equal(zonedIso(null, 'UTC'), null);
});

test('search_my_materials: the shared search, with course labels, snippets, timestamps and links', async () => {
  let asked = null;
  const ctx = context(tables, { rpc: { search_my_materials: args => { asked = args; return [
    { kind: 'lecture', id: U(50), title: 'Lecture 4', course_id: U(103), snippet: 'the mitochondria is on the exam', timestamp_seconds: 95, card_index: null },
    { kind: 'flashcard', id: U(1), title: 'Cell biology', course_id: U(101), snippet: 'What makes ATP? — Mitochondria', timestamp_seconds: null, card_index: 0 },
  ]; } } });
  const result = await call('search_my_materials', ctx, { query: 'mitochondria', kinds: ['lecture', 'flashcard'], limit: 5 });
  assert.deepEqual(asked, { search: 'mitochondria', course: null, kinds: ['lecture', 'flashcard'], max_results: 5 });
  const [lecture, card] = result.structuredContent.results;
  assert.equal(lecture.timestamp_seconds, 95);
  assert.equal(lecture.course.name, 'Course 2');
  assert.equal(lecture.url, `https://classroom.cordiacode.com/lecture/${U(50)}`);
  assert.equal(card.url, `https://classroom.cordiacode.com/flashcards/study?guideId=${U(1)}`);
  assert.equal(card.card_index, 0);
});

test('list_study_sets: newest first, pages with a cursor, never Canvas columns', async () => {
  const ctx = context(tables);
  const first = await call('list_study_sets', ctx, { limit: 2 });
  assert.deepEqual(first.structuredContent.study_sets.map(set => set.title), ['Cell biology', 'Module 3 page']);
  assert.equal(first.structuredContent.study_sets[0].created_at, '2026-10-30T10:00:00-05:00');
  assert.equal(first.structuredContent.study_sets[0].card_count, 2);
  assert.equal(first.structuredContent.study_sets[0].has_quiz, true);
  assert.equal(first.structuredContent.study_sets[1].status, 'notes_only');
  const second = await call('list_study_sets', ctx, { limit: 2, cursor: first.structuredContent.next_cursor });
  assert.deepEqual(second.structuredContent.study_sets.map(set => set.title), ['Verbos']);
  assert.equal(second.structuredContent.next_cursor, null);
  const inCourse = await call('list_study_sets', ctx, { course_id: U(102) });
  assert.deepEqual(inCourse.structuredContent.study_sets.map(set => set.course.name), ['My Spanish']);
  const named = await call('list_study_sets', ctx, { query: 'verb' });
  assert.equal(named.structuredContent.study_sets.length, 1);
  assert.ok(!/source_title|source_url|external_source_id|instructure/.test(JSON.stringify(first.structuredContent)));
  const bad = await call('list_study_sets', ctx, { cursor: 'nonsense' });
  assert.equal(bad.isError, true);
});

test('get_study_set: default sections, others on request, the same answer for missing and not yours', async () => {
  const ctx = context(tables);
  const result = await call('get_study_set', ctx, { study_set_id: U(1) });
  const { sections } = result.structuredContent;
  assert.deepEqual(Object.keys(sections), ['notes', 'outline', 'key_terms']);
  assert.deepEqual(sections.outline, [{ heading: 'Organelles', points: ['The **mitochondria** makes ATP'] }]);
  assert.deepEqual(sections.key_terms, [{ term: 'mitochondria', context: 'The mitochondria makes ATP' }]);
  const more = await call('get_study_set', ctx, { study_set_id: U(1), include: ['flashcards', 'quiz', 'practice'] });
  assert.equal(more.structuredContent.sections.flashcards[0].card_id, `${U(1)}:card:0`);
  assert.equal(more.structuredContent.sections.flashcards[0].due_on, '2099-01-01');
  assert.equal(more.structuredContent.sections.quiz[0].answer, 'b');
  assert.equal(more.structuredContent.sections.practice[0].solved, true);
  assert.ok(!JSON.stringify(more.structuredContent).includes('data:image'));
  const missing = await call('get_study_set', ctx, { study_set_id: U(999) });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /^No study set with that id in your Cordia account/);
});

test('get_study_set: a big set comes in pages under the size cap', async () => {
  const big = { ...guides[0], id: U(9), flashcards: Array.from({ length: 400 }, (_, i) => ({ front: `Question ${i}`, back: 'x'.repeat(300) })) };
  const ctx = context({ ...tables, study_guides: [big] });
  const first = await call('get_study_set', ctx, { study_set_id: U(9), include: ['flashcards'] });
  assert.equal(first.structuredContent.truncated, true);
  const count = first.structuredContent.sections.flashcards.length;
  assert.ok(count > 10 && count < 400);
  const second = await call('get_study_set', ctx, { study_set_id: U(9), include: ['flashcards'], cursor: first.structuredContent.next_cursor });
  assert.equal(second.structuredContent.sections.flashcards[0].front, `Question ${count}`);
  assert.equal(decodeCursor(first.structuredContent.next_cursor).o, count);
});

test('lectures: list, then outline, watch-for, to-dos, terms and a paged transcript', async () => {
  const ctx = context(tables);
  const list = await call('list_lectures', ctx, {});
  assert.deepEqual(list.structuredContent.lectures[0], { id: U(50), title: 'Lecture 4', course: { id: U(103), name: 'Course 2', example_study_sets: [] }, recorded_at: '2026-10-28', duration_seconds: 3000, has_summary: true, url: `https://classroom.cordiacode.com/lecture/${U(50)}` });
  const lecture = await call('get_lecture', ctx, { lecture_id: U(50) });
  const out = lecture.structuredContent;
  assert.deepEqual(out.watch_for, [{ quote: 'this is on the exam', timestamp_seconds: 95, note: 'On the exam: Know the parts' }]);
  assert.deepEqual(out.todos, [{ text: 'Read chapter 5', kind: 'reading', due_date: '2026-11-03', timestamp_seconds: 90 }]);
  assert.equal(out.transcript, null);
  assert.equal(out.student_notes, 'ask about ATP');
  const page = await call('get_lecture', ctx, { lecture_id: U(50), include_transcript: true });
  assert.ok(page.structuredContent.transcript.length > 5 && page.structuredContent.next_cursor);
  const next = await call('get_lecture', ctx, { lecture_id: U(50), include_transcript: true, cursor: page.structuredContent.next_cursor });
  assert.equal(next.structuredContent.transcript[0].timestamp_seconds, page.structuredContent.transcript.length * 10);
  assert.equal((await call('get_lecture', ctx, { lecture_id: U(51) })).isError, true);
});

test('get_due_cards: Study now\'s order, the student\'s day, confidence and misses from history', async () => {
  const ctx = context(tables);
  const result = await call('get_due_cards', ctx, { limit: 10 });
  const cards = result.structuredContent.cards;
  assert.equal(cards[0].kind, 'missed_question', 'a question missed while sure comes first');
  assert.equal(cards[0].missed_while_sure, true);
  assert.equal(cards[0].last_confidence, 'sure');
  const ser = cards.find(card => card.front === 'ser');
  assert.deepEqual([ser.card_id, ser.kind, ser.last_confidence, ser.times_wrong], [`${U(3)}:card:0`, 'flashcard', 'think', 1]);
  assert.ok(!cards.some(card => card.front === 'What makes ATP?'), 'a card scheduled for later is not due');
  assert.equal(result.structuredContent.total_due, cards.length);
  assert.equal(result.structuredContent.today, localDay(new Date(), 'America/Chicago'));
  const one = await call('get_due_cards', ctx, { study_set_id: U(1) });
  assert.deepEqual(one.structuredContent.cards.map(card => card.front), ['Powerhouse?'], 'only the new card; the other is scheduled later');
  const later = { ...guides[0], id: U(8), flashcard_progress: { schedule: { 0: { box: 2, due: '2099-01-01' }, 1: { box: 2, due: '2099-01-01' } } } };
  const whole = await call('get_due_cards', context({ ...tables, study_guides: [later] }), { study_set_id: U(8) });
  assert.equal(whole.structuredContent.cards.length, 2, 'Study now on one set with nothing due runs its whole deck');
  assert.equal((await call('get_due_cards', ctx, { study_set_id: U(999) })).isError, true);
});

test('get_progress: the backend\'s Progress numbers plus the study log\'s streak with a freeze', async () => {
  let asked = '';
  const today = localDay(new Date(), 'America/Chicago');
  const day = offset => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const ctx = context({ ...tables, study_days: [0, 1, 3, 4].map(offset => ({ day: day(offset), minutes: 10, cards: 0, total: 0 })) }, {
    fetchBackend: async path => { asked = path; return { ok: true, status: 200, json: async () => ({
      streak_days: 2, studied_today: true, week: [], active_study_minutes: 95,
      quiz_accuracy_trend: [{ date: day(1), accuracy: 70, study_set_id: U(1), study_set: 'Cell biology' }],
      best_study_hours: [{ hour: 20, minutes: 60 }], weak_topics: [{ topic: 'Cell biology', accuracy: 60, last_seen: day(1), study_set_id: U(1) }],
      question_types_needing_work: [{ type: 'Why questions', accuracy: 40, answered: 6 }],
    }) }; },
  });
  const result = await call('get_progress', ctx, { range: '7d' });
  assert.equal(asked, `/mcp/progress?since=${day(6)}`);
  assert.equal(result.structuredContent.streak_days, 4, 'one missed day a week is forgiven (not counted), like the app');
  assert.equal(result.structuredContent.active_study_minutes, 95);
  assert.equal(result.structuredContent.weak_topics[0].url, `https://classroom.cordiacode.com/guide/${U(1)}`);
  const down = await call('get_progress', context(tables), {});
  assert.equal(down.isError, true);
});

test('get_job_status: a job, or the not-found answer', async () => {
  const ctx = context(tables);
  const job = await call('get_job_status', ctx, { job_id: U(70) });
  assert.deepEqual([job.structuredContent.status, job.structuredContent.study_set_id, job.structuredContent.error], ['done', U(1), null]);
  assert.equal((await call('get_job_status', ctx, { job_id: U(71) })).isError, true);
});

test('Hard Rule 1: nothing the MCP server loads talks to Canvas or another LMS', () => {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    assert.ok(!/instructure|canvas_(tokens|courses|assignments|announcements|connections)|blackboard|moodle|canvasClient|\/canvas\//i.test(source.replace(/^\s*\/\/.*$/gm, '')), `${file} touches LMS code or data`);
    for (const [, path] of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) visit(new URL(path, `file://${file}`).pathname);
  };
  visit(new URL('../lib/mcp/endpoint.mjs', import.meta.url).pathname);
  assert.ok(seen.size > 10);
  assert.ok(readdirSync(new URL('../lib/mcp/', import.meta.url)).every(name => !/canvas/i.test(name)));
});
