// The MCP write tools against an in-memory stand-in for the student's Supabase client; the database
// functions themselves (ownership, add-only, idempotency, rate limits) are tested on Postgres in
// tests/rls/mcp_write_tools_rls.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod';
import { WRITE, WRITE_TOOLS } from '../lib/mcp/writeTools.mjs';
import { READ_TOOLS } from '../lib/mcp/readTools.mjs';
import { guarded } from '../lib/mcp/register.mjs';
import { MAX_CHARS, failure } from '../lib/mcp/output.mjs';
import { markdownToOutline } from '../lib/markdownOutline.mjs';
import { applyAnswer, parseItemId, sourcesFor } from '../lib/studyAnswer.mjs';
import { applyResults, scheduleChanges } from '../lib/spacedReview.mjs';
import { changedLevels } from '../lib/learnEngine.mjs';
import { addStudy } from '../lib/studyDays.mjs';

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GUIDE = U(1);

function fakeDb(tables, rpc = {}) {
  const calls = [];
  const from = name => {
    let rows = [...(tables[name] || [])];
    let single = false;
    const builder = {
      select() { return builder; },
      eq(column, value) { rows = rows.filter(row => row[column] === value); return builder; },
      maybeSingle() { single = true; return builder; },
      then(resolve) { resolve({ data: single ? rows[0] || null : rows, error: null }); },
    };
    return builder;
  };
  return {
    calls,
    from,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const out = rpc[name] ? rpc[name](args) : { data: null };
      return { data: out.data ?? null, error: out.error || null };
    },
  };
}

function context(tables, { rpc, backend } = {}) {
  const db = fakeDb(tables, rpc);
  const sent = [];
  return {
    db,
    sent,
    baseUrl: 'https://classroom.cordiacode.com',
    timeZone: 'America/Chicago',
    load: async () => {},
    fetchBackend: async (path, options) => { sent.push({ path, ...options }); return backend ? backend(path, options) : { ok: true, status: 200, json: async () => ({ logged: false }) }; },
  };
}

const guide = () => ({
  id: GUIDE, title: 'Cell biology',
  flashcards: [{ front: 'What makes ATP?', back: 'Mitochondria' }, { front: 'Powerhouse of the cell', back: 'Mitochondria' }],
  flashcard_progress: { schedule: { 0: { box: 1, due: '2026-11-01' } }, known: [0] },
  quiz_questions: [
    { question: 'What makes ATP?', options: ['Ribosome', 'Mitochondria'], correct_index: 1 },
    { question: 'Name the cell membrane\'s job', options: ['Controls what enters and leaves the cell', 'Makes proteins'], correct_index: 0 },
  ],
  practice_state: { problems: [{ prompt: '2+2', answer: '4' }] },
});

const tool = name => WRITE_TOOLS.find(item => item.name === name);
async function call(name, ctx, args) {
  const definition = tool(name);
  const result = await definition.run(ctx, z.object(definition.input).strict().parse(args));
  if (!result.isError) {
    z.object(definition.output).parse(result.structuredContent);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.ok(result.content[0].text.length <= MAX_CHARS);
  }
  return result;
}

test('every write tool: title, accurate annotations, tight input limits, a 1–3 sentence description', () => {
  assert.deepEqual(WRITE, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  assert.deepEqual(WRITE_TOOLS.map(item => [item.name, item.annotations.idempotentHint]),
    [['record_answer', true], ['create_study_set', false], ['add_flashcards', false], ['save_note', false]]);
  const names = [...READ_TOOLS, ...WRITE_TOOLS].map(item => item.name);
  assert.equal(new Set(names).size, 12);
  for (const item of WRITE_TOOLS) {
    assert.match(item.name, /^[a-z_]+$/);
    const sentences = item.description.split(/(?<=\.)\s+(?=[A-Z])/).length;
    assert.ok(sentences >= 1 && sentences <= 3, `${item.name}: ${sentences} sentences`);
    assert.throws(() => z.object(item.input).strict().parse({ unexpected: 1 }), item.name);
  }
  const parse = (name, args) => z.object(tool(name).input).strict().parse(args);
  assert.throws(() => parse('create_study_set', { source: { type: 'url', url: 'ftp://example.com/x' } }));
  assert.throws(() => parse('create_study_set', { source: { type: 'text', text: 'too short' } }));
  assert.throws(() => parse('create_study_set', { source: { type: 'youtube', url: 'https://youtu.be/x' } }));
  assert.throws(() => parse('add_flashcards', { study_set_id: GUIDE, cards: [] }));
  assert.throws(() => parse('add_flashcards', { study_set_id: GUIDE, cards: Array.from({ length: 51 }, () => ({ front: 'a', back: 'b' })) }));
  assert.throws(() => parse('add_flashcards', { study_set_id: GUIDE, cards: [{ front: 'x'.repeat(501), back: 'b' }] }));
  assert.throws(() => parse('save_note', { title: 'x'.repeat(201), content: 'c' }));
  assert.throws(() => parse('record_answer', { item_type: 'flashcard', item_id: `${GUIDE}:card:0`, correct: true, confidence: 'certain', idempotency_key: 'k' }));
  assert.throws(() => parse('record_answer', { item_type: 'flashcard', item_id: `${GUIDE}:card:0`, correct: true, confidence: 'sure', idempotency_key: 'k', response_text: 'x'.repeat(1001) }));
});

test('item ids: the ones get_due_cards and get_study_set hand out', () => {
  assert.deepEqual(parseItemId(`${GUIDE}:card:3`), { guideId: GUIDE, kind: 'card', ref: 3 });
  assert.deepEqual(parseItemId(`${GUIDE}:quiz:1`), { guideId: GUIDE, kind: 'idea', ref: 1 });
  assert.deepEqual(parseItemId(`${GUIDE}:miss:conjugate%20ir`), { guideId: GUIDE, kind: 'miss', ref: 'conjugate ir' });
  assert.deepEqual(parseItemId(`${GUIDE}:miss:conjugate%2`), { guideId: GUIDE, kind: 'miss', ref: 'conjugate' });
  for (const bad of ['', 'card:1', `${GUIDE}:card:x`, `${GUIDE}:grade:1`, 'x:card:1']) assert.equal(parseItemId(bad), null, bad);
});

test('scheduler parity: a flashcard answer moves the box exactly as the app\'s Flashcards and Study now', () => {
  const g = guide();
  const sources = sourcesFor(g, [], parseItemId(`${GUIDE}:card:0`));
  // The card's question is also a Learn idea, so the answer reaches both, as in Study now.
  assert.deepEqual([sources.index, sources.concept], [0, 0]);
  const on = new Date(2026, 10, 2, 12);
  const change = applyAnswer(g, [], sources, { correct: true, confidence: 'sure', today: '2026-11-02', on });
  const app = applyResults(g.flashcard_progress, { known: [0] }, on);
  assert.deepEqual(change.cards, scheduleChanges(app, [0]));
  assert.equal(change.nextDueOn, app.schedule[0].due);
  assert.equal(change.misses, null);
});

test('a quiz question missed while sure is kept first in Retain misses; answering it right clears it', () => {
  const g = guide();
  const parsed = parseItemId(`${GUIDE}:quiz:1`);
  const wrong = applyAnswer(g, [{ question: 'Older miss', answer: 'x' }], sourcesFor(g, [], parsed), { correct: false, confidence: 'sure', today: '2026-11-02', on: new Date(2026, 10, 2, 12) });
  assert.deepEqual(wrong.misses[0], { question: 'Name the cell membrane\'s job', answer: 'Controls what enters and leaves the cell', sure: true });
  assert.equal(wrong.learn.levels[1].sure, true);
  const right = applyAnswer(g, wrong.misses, sourcesFor(g, wrong.misses, parseItemId(`${GUIDE}:miss:${encodeURIComponent('name the cell membrane s job')}`)), { correct: true, confidence: 'think', today: '2026-11-02', on: new Date(2026, 10, 2, 12) });
  assert.deepEqual(right.misses, [{ question: 'Older miss', answer: 'x' }]);
});

test('record_answer: saves everything in one call, logs the answer once, and a repeat is replayed', async () => {
  let saved = null;
  const ctx = context({ study_guides: [guide()], retain_misses: [], study_days: [] }, {
    rpc: { mcp_record_answer: args => { saved = saved ? { ...saved.result, replayed: true } : args; return { data: saved.result ? { ...args.result, replayed: false } : saved }; } },
  });
  const args = { item_type: 'flashcard', item_id: `${GUIDE}:card:1`, correct: false, confidence: 'guess', response_text: 'ribosome', idempotency_key: 'turn-7-q-3' };
  const first = await call('record_answer', ctx, args);
  assert.equal(first.isError, undefined);
  const sent = ctx.db.calls.find(item => item.name === 'mcp_record_answer').args;
  assert.equal(sent.answer_key, 'turn-7-q-3');
  assert.deepEqual(Object.keys(sent.cards), ['1']);
  assert.equal(sent.cards[1].box, 0);
  assert.equal(sent.study_day.cards, 1);
  assert.equal(sent.study_day.right_count, 0);
  assert.deepEqual(sent.study_day.guides[GUIDE.slice(0, 8)].k, ['cards']);
  assert.equal(first.structuredContent.replayed, false);
  assert.ok(first.structuredContent.remaining_due_in_set >= 1);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].path, '/mcp/learning-events');
  assert.deepEqual(ctx.sent[0].body.events[0], { guide_id: GUIDE, fingerprint: 'powerhouse of the cell', format: 'flashcard', outcome: 'again', confidence: 'guess', answer_chars: 8, occurred_at: null });
  assert.ok(!JSON.stringify(ctx.sent[0].body).includes('ribosome'), 'the answer text is never sent on');

  const again = await call('record_answer', ctx, args);
  assert.equal(again.structuredContent.replayed, true);
  assert.equal(ctx.sent.length, 1, 'a replay is not logged twice');
});

test('record_answer: unknown, foreign and mismatched items are refused the same way', async () => {
  const ctx = context({ study_guides: [guide()], retain_misses: [], study_days: [] });
  const base = { correct: true, confidence: 'sure', idempotency_key: 'k' };
  const foreign = await call('record_answer', ctx, { ...base, item_type: 'flashcard', item_id: `${U(9)}:card:0` });
  const missing = await call('record_answer', ctx, { ...base, item_type: 'flashcard', item_id: `${GUIDE}:card:9` });
  assert.equal(foreign.isError, true);
  assert.equal(missing.isError, true);
  const mismatch = await call('record_answer', ctx, { ...base, item_type: 'practice', item_id: `${GUIDE}:card:0` });
  assert.match(mismatch.content[0].text, /not one Cordia gave/);
  const practice = await call('record_answer', ctx, { ...base, item_type: 'practice', item_id: `${GUIDE}:practice:0` });
  assert.equal(practice.isError, undefined);
  assert.deepEqual(ctx.db.calls.at(-1).args.practice, { index: 0, status: 'correct', message: 'Answered in a connected AI app.' });
});

test('create_study_set: queued at once; plan limits and refused links come back as clear errors', async () => {
  const replies = {
    ok: { status: 200, body: { job_id: U(70), status: 'queued' } },
    repeat: { status: 200, body: { job_id: U(70), status: 'done' } },
    limit: { status: 402, body: { detail: { message: 'You have used all 3 study guides this month.', upgrade_url: '/settings?section=subscription' } } },
    lms: { status: 422, body: { detail: 'Cordia can\'t read Canvas, Blackboard, Moodle or other LMS pages from here. Open the page in your browser and use the Cordia extension to add it.' } },
  };
  for (const [name, reply] of Object.entries(replies)) {
    const ctx = context({}, { backend: async () => ({ ok: reply.status === 200, status: reply.status, json: async () => reply.body }) });
    const result = await call('create_study_set', ctx, { source: { type: 'url', url: 'https://en.wikipedia.org/wiki/Mitochondrion' }, title: 'Mitochondria' });
    assert.equal(ctx.sent[0].path, '/mcp/study-sets');
    assert.equal(ctx.sent[0].method, 'POST');
    if (name === 'ok') assert.deepEqual([result.structuredContent.job_id, result.structuredContent.status], [U(70), 'queued']);
    // The same request sent again: the job already made, and no second study set.
    if (name === 'repeat') {
      assert.deepEqual([result.structuredContent.job_id, result.structuredContent.status], [U(70), 'done']);
      assert.match(result.structuredContent.message, /did not make a second study set.*get_job_status/);
    }
    if (name === 'limit') assert.match(result.content[0].text, /3 study guides.*https:\/\/classroom\.cordiacode\.com\/settings\?section=subscription/);
    if (name === 'lms') assert.match(result.content[0].text, /extension/);
  }
});

test('add_flashcards and save_note: add-only database calls, ids and links back', async () => {
  const ctx = context({}, { rpc: {
    mcp_add_flashcards: () => ({ data: { added_count: 1, skipped_duplicates: 1, card_indexes: [2] } }),
    mcp_save_note: () => ({ data: U(80) }),
  } });
  const cards = await call('add_flashcards', ctx, { study_set_id: GUIDE, cards: [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }] });
  assert.deepEqual(cards.structuredContent.card_ids, [`${GUIDE}:card:2`]);
  const note = await call('save_note', ctx, { title: ' Exam prep ', content: '# Cells\n\nThe **mitochondria** makes ATP.\n\n- Krebs cycle\n  - in the matrix', course_id: U(101) });
  assert.equal(note.structuredContent.url, `https://classroom.cordiacode.com/guide/${U(80)}`);
  const args = ctx.db.calls.at(-1).args;
  assert.deepEqual([args.title, args.course, args.study_set], ['Exam prep', U(101), null]);
  assert.equal(args.notes, '## Cells\n- The **mitochondria** makes ATP.\n- Krebs cycle\n  - in the matrix');
  const refused = context({}, { rpc: { mcp_add_flashcards: () => ({ error: { code: 'P0002', message: 'No study set with that id' } }) } });
  assert.match((await call('add_flashcards', refused, { study_set_id: U(9), cards: [{ front: 'a', back: 'b' }] })).content[0].text, /No study set with that id in your Cordia account/);
});

test('Markdown becomes the Outline\'s text', () => {
  assert.equal(markdownToOutline('> What this is\n## Part\n1. First\n2. Second [link](https://x.org)\n```\ncode line\n```\n---\n### Deeper\nplain line'),
    '> What this is\n## Part\n- First\n- Second link (https://x.org)\n- code line\n- **Deeper**\n- plain line');
  assert.equal(markdownToOutline('   \n\n'), '');
  assert.equal(markdownToOutline('<script>alert(1)</script>'), '- <script>alert(1)</script>', 'kept as text; the Outline escapes it');
});

test('guarded: rate limits, audit metadata only, and failures never throw', async () => {
  const logged = [];
  const base = { load: async () => {}, logCall: async (...entry) => logged.push(entry) };
  const definition = { name: 'add_flashcards' };
  const limited = await guarded({ ...base, takeCall: async () => false }, definition, 'write', async () => assert.fail('ran'));
  assert.match(limited.content[0].text, /30 at most/);
  await guarded({ ...base, takeCall: async () => true }, definition, 'write', async () => failure('nope', 'not_found'));
  await guarded({ ...base, takeCall: async () => null }, definition, 'write', async () => { throw new Error('secret'); });
  await guarded({ ...base, takeCall: async () => true }, definition, 'write', async () => ({ content: [] }));
  assert.deepEqual(logged.map(entry => entry.slice(0, 3)), [
    ['add_flashcards', 'rate_limited', 'rate_limited'], ['add_flashcards', 'error', 'not_found'], ['add_flashcards', 'error', 'exception'], ['add_flashcards', 'ok', null],
  ]);
  assert.ok(logged.every(entry => entry.length === 4 && Number.isInteger(entry[3])), 'only tool, status, code and time');
});

test('shared helpers: only what changed is saved, and the study log adds like the app', () => {
  assert.deepEqual(changedLevels({ 0: { l: 1, at: 'a', q: 'x' } }, { 0: { l: 1, at: 'a', q: 'x' }, 1: { l: 2, at: 'b', q: 'y' } }), { 1: { l: 2, at: 'b', q: 'y' } });
  const day = addStudy(addStudy({}, { guideId: GUIDE, guideTitle: 'Cells', cards: 1, right: 1, total: 1, kind: 'cards' }), { guideId: GUIDE, cards: 1, total: 1, kind: 'quiz' });
  assert.deepEqual(day, { m: 0, c: 2, r: 1, t: 2, g: { [GUIDE.slice(0, 8)]: { n: 'Cells', m: 0, k: ['cards', 'quiz'] } } });
  const odd = addStudy({}, { guideId: '__proto__', cards: 1 }).g;
  assert.equal(Object.getPrototypeOf(odd), Object.prototype, 'a guide key never replaces the prototype');
});
