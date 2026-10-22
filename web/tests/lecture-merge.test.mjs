// Merging a lecture recorded in parts: joined in order with timings shifted, saved as one
// lecture with fresh notes, then the parts and their notes pages removed. Never other people's rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLectureLibrary } from '../lib/server/lectureLibrary.mjs';

const USER = '11111111-2222-4333-8444-555555555555';
const CLASS = 'f0000000-0000-4000-8000-000000000001';
const PART1 = 'c0000000-0000-4000-8000-000000000001';
const PART2 = 'c0000000-0000-4000-8000-000000000002';
const MERGED = 'c0000000-0000-4000-8000-000000000009';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PARTS = [
  // Returned out of order: the merge sorts by date, then by when each was saved.
  { id: PART2, title: 'Supply and demand (part 2)', folder_id: CLASS, source: 'recording', lecture_date: '2026-10-17', created_at: '2026-10-17T15:40:00Z', duration_ms: 30000,
    transcript: 'Part two covers price ceilings and why shortages follow from them in a market.', segments: [{ start_ms: 0, text: 'Part two covers price ceilings.' }, { start_ms: 20000, text: 'Shortages follow from them.' }], analysis: { note_id: 'note-2' } },
  { id: PART1, title: 'Supply and demand', folder_id: CLASS, source: 'recording', lecture_date: '2026-10-17', created_at: '2026-10-17T15:00:00Z', duration_ms: 45000,
    transcript: 'Part one covers supply and demand curves and how they shift with market conditions.', segments: [{ start_ms: 0, text: 'Part one covers the curves.' }, { start_ms: 30000, text: 'They shift with conditions.' }], analysis: { note_id: 'note-1' } },
];

function world({ parts = PARTS } = {}) {
  const state = { inserted: null, deleted: [], notesDeleted: [], urls: [] };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    state.urls.push(`${method} ${url}`);
    if (url === 'https://api.example.com/billing/status') return json({ plan: 'free' });
    if (url === 'https://api.openai.com/v1/chat/completions') return json({ choices: [{ message: { content: JSON.stringify({ title: 'Supply and Demand', summary: ['Prices and shortages.'] }) } }] });
    if (url === 'https://api.example.com/folders') return json({ folders: [{ id: CLASS, name: 'Econ 101' }] });
    if (url === 'https://api.example.com/smart_notes' && method === 'POST') return json({ note: { id: 'note-9' } });
    if (url.startsWith('https://api.example.com/smart_notes/') && method === 'PUT') return json({ ok: true });
    if (url.startsWith('https://api.example.com/smart_notes/') && method === 'DELETE') { state.notesDeleted.push(url.split('/').pop()); return json({ ok: true }); }
    if (url.startsWith(`https://db.example.co/rest/v1/lectures?user_id=eq.${USER}&id=in.(`)) return json(parts);
    if (url === 'https://db.example.co/rest/v1/lectures' && method === 'POST') { state.inserted = JSON.parse(init.body); return json([{ id: MERGED, ...state.inserted }], 201); }
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos') && method === 'POST') return json(null, 201);
    if (url.startsWith('https://db.example.co/rest/v1/lectures?id=eq.') && method === 'PATCH') return json(null, 204);
    if (url.startsWith('https://db.example.co/rest/v1/lectures?id=eq.') && method === 'DELETE') { state.deleted.push(url); return json(null, 204); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const library = createLectureLibrary({
    env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', OPENAI_API_KEY: 'sk' },
    fetch, today: () => new Date('2026-10-17T15:00:00Z'),
  });
  return { library, state };
}

test('parts are joined in order, timings shifted, saved as one, then removed', async () => {
  const { library, state } = world();
  const result = await library.merge(AUTH, { ids: [PART2, PART1] });
  assert.equal(result.status, 200);
  assert.equal(result.body.lecture.id, MERGED);
  assert.equal(result.body.merged, 2);
  const saved = state.inserted;
  assert.ok(saved.transcript.startsWith('Part one'), 'part one first');
  assert.ok(saved.transcript.includes('\n\nPart two'));
  // Part two's timings start after part one's 45 seconds.
  assert.deepEqual(saved.segments.map(item => item.start_ms), [0, 30000, 45000, 65000]);
  assert.equal(saved.duration_ms, 75000);
  assert.equal(saved.folder_id, CLASS);
  assert.equal(saved.lecture_date, '2026-10-17');
  assert.equal(state.deleted.length, 2);
  assert.ok(state.deleted.every(url => url.includes(`user_id=eq.${USER}`)), 'only the student\'s own rows are deleted');
  assert.deepEqual(state.notesDeleted.sort(), ['note-1', 'note-2']);
});

test('needs two of the student\'s own lectures; nothing is removed when one is missing', async () => {
  const one = world();
  assert.equal((await one.library.merge(AUTH, { ids: [PART1] })).status, 400);
  const missing = world({ parts: [PARTS[1]] });
  const result = await missing.library.merge(AUTH, { ids: [PART1, PART2] });
  assert.equal(result.status, 404);
  assert.equal(missing.state.inserted, null);
  assert.equal(missing.state.deleted.length, 0);
  assert.equal((await one.library.merge('Bearer nope', { ids: [PART1, PART2] })).status, 401);
});
