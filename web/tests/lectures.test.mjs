// The Lectures section with a fake network: saving and analysing a lecture (unsupported quotes
// dropped, spoken dates kept with the worked-out date), listing, opening, to-dos and their trip
// to Calendar, only the student's own rows, and the not-set-up state.
import assert from 'node:assert/strict';
import { cleanAnalysis, createLectureLibrary, lectureText, supported } from '../lib/server/lectureLibrary.mjs';
import { lectureCalendarItems, mergeCalendarItems } from '../lib/lectureCalendar.mjs';

const USER = '11111111-2222-4333-8444-555555555555';
const CLASS = 'f0000000-0000-4000-8000-000000000001';
const LECTURE = 'c0000000-0000-4000-8000-000000000001';
const TODO = 'd0000000-0000-4000-8000-000000000001';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SEGMENTS = [
  { start_ms: 0, text: 'Today we cover supply and demand.' },
  { start_ms: 20000, text: 'This will definitely be on the midterm, so know how the curves shift.' },
  { start_ms: 40000, text: 'Problem set three is due next Friday before class.' },
];

function world({ env = {}, analysis, stored = { id: LECTURE, title: 'Supply and Demand Basics' } } = {}) {
  const state = { inserts: {}, patches: [], urls: [], notes: [], lecturePatches: [] };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    state.urls.push(`${method} ${url}`);
    if (url === 'https://api.example.com/billing/status') return init.headers.Authorization === AUTH ? json({ plan: 'free' }) : json({}, 401);
    if (url === 'https://api.openai.com/v1/chat/completions') {
      state.prompt = JSON.parse(init.body).messages[1].content;
      return json({ choices: [{ message: { content: JSON.stringify(analysis ?? {
        title: 'Supply and Demand Basics', class_id: CLASS, summary: ['Supply and demand set prices.'],
        watch_for: [
          { point: 'Know how the curves shift', why: 'exam', quote: 'This will definitely be on the midterm', at_ms: 25000 },
          { point: 'Invented point', why: 'exam', quote: 'The final is worth ninety percent', at_ms: 0 },
        ],
        todos: [{ title: 'Problem set 3', kind: 'assignment', said: 'next Friday', due_date: '2026-10-24', quote: 'Problem set three is due next Friday', at_ms: 41000 }],
        outline: [{ heading: 'Supply and demand', at_ms: 0, points: ['Curves shift with conditions'] }],
        terms: [{ term: 'Demand curve', definition: 'Shows quantity wanted at each price', at_ms: 0 }],
        questions: [{ question: 'What happens when supply falls?', at_ms: 20000 }],
      }) } }] });
    }
    if (url === 'https://api.example.com/smart_notes' && method === 'POST') { state.notes.push({ created: JSON.parse(init.body) }); return json({ note: { id: 'note-1' } }); }
    if (url.startsWith('https://api.example.com/smart_notes/') && method === 'GET') return url.endsWith('/note-gone') ? json({ detail: 'Note not found' }, 404) : json({ note: { id: url.split('/').pop() } });
    if (url.startsWith('https://api.example.com/smart_notes/') && method === 'PUT') { state.notes.push({ id: url.split('/').pop(), ...JSON.parse(init.body) }); return json({ ok: true }); }
    if (url === 'https://api.example.com/folders') return json({ folders: [{ id: CLASS, name: 'Econ 101' }] });
    if (url.startsWith('https://db.example.co/rest/v1/lectures') && method === 'POST') { state.inserts.lecture = JSON.parse(init.body); return json([{ id: LECTURE, ...state.inserts.lecture }], 201); }
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos') && method === 'POST') { state.inserts.todos = JSON.parse(init.body); return json(null, 201); }
    if (url.startsWith('https://db.example.co/rest/v1/lectures?user_id=')) return json([{ id: LECTURE, title: 'Supply and Demand Basics', folder_id: CLASS, source: 'recording', lecture_date: '2026-10-17', duration_ms: 60000, analysis: { summary: ['Supply and demand set prices.'], watch_for: [{}] } }]);
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos?user_id=') && url.includes('status=in.')) return json([{ lecture_id: LECTURE, status: 'suggested' }]);
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos?user_id=') && url.includes('status=eq.confirmed')) return json([{ id: TODO, title: 'Problem set 3', kind: 'assignment', due_at: '2026-10-24T23:59:00Z', lecture_id: LECTURE, lectures: { title: 'Supply and Demand Basics', folder_id: CLASS } }]);
    if (url.startsWith(`https://db.example.co/rest/v1/lectures?id=eq.${LECTURE}&user_id=eq.${USER}`) && method === 'GET') return json([stored]);
    if (url.startsWith('https://db.example.co/rest/v1/lectures?id=eq.')) { if (method === 'PATCH') state.lecturePatches.push(JSON.parse(init.body)); return method === 'GET' ? json([]) : json(null, 204); }
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos?lecture_id=')) return json([{ id: TODO, title: 'Problem set 3', status: 'suggested' }]);
    if (url.startsWith('https://db.example.co/rest/v1/lecture_todos?id=eq.') && method === 'PATCH') { state.patches.push({ url, body: JSON.parse(init.body) }); return json([{ id: TODO, ...JSON.parse(init.body) }]); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const library = createLectureLibrary({
    env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', OPENAI_API_KEY: 'sk', ...env },
    fetch, today: () => new Date('2026-10-17T15:00:00Z'),
  });
  return { library, state };
}

// Quotes must really be in the lecture.
const text = lectureText('', SEGMENTS);
assert.ok(supported('this will DEFINITELY be on the midterm!', text));
assert.ok(!supported('The final is worth ninety percent', text));
assert.ok(text.startsWith('[0] Today we cover'));
const cleaned = cleanAnalysis({ watch_for: [{ point: 'x', quote: 'due next Friday before class', at_ms: 45000 }], todos: [{ title: 'PS3', quote: 'no such words here at all', due_date: 'soon' }] }, { text, starts: [0, 20000, 40000] });
assert.equal(cleaned.watch_for[0].at_ms, 40000, 'times snap to the line they came from');
assert.equal(cleaned.todos.length, 0);
console.log('ok   only quoted, supported items are kept; times snap to lines');

{
  const { library, state } = world();
  const { status, body } = await library.save(AUTH, { segments: SEGMENTS, lecture_date: '2026-10-17', duration_ms: 60000, classes: [{ id: CLASS, name: 'Econ 101' }] });
  assert.equal(status, 200);
  assert.equal(body.lecture.title, 'Supply and Demand Basics');
  assert.ok(state.prompt.includes('Lecture date: 2026-10-17 (Saturday)'), 'lecture date given for working out dates');
  assert.equal(state.inserts.lecture.user_id, USER);
  assert.equal(state.inserts.lecture.folder_id, CLASS, 'class suggested by the AI');
  assert.equal(state.inserts.lecture.analysis.watch_for.length, 1, 'the unsupported watch-for item was dropped');
  assert.equal(state.inserts.lecture.analysis.watch_for[0].at_ms, 20000);
  assert.deepEqual(state.inserts.todos.map(item => [item.title, item.due_at, item.said]), [['Problem set 3', '2026-10-24T23:59:00Z', 'next Friday']]);
  assert.equal(state.inserts.lecture.audio, undefined, 'no audio stored');
  const note = state.notes.find(item => item.content);
  assert.ok(note && note.title === 'Supply and Demand Basics' && note.folder_id === CLASS, 'the lecture is filed in Notes under its class');
  assert.ok(note.content.includes('Supply and demand') && note.content.includes('Curves shift with conditions'), 'the note holds the outline');
  assert.equal(state.lecturePatches.at(-1).analysis.note_id, 'note-1');
  console.log('ok   save: analysed once, stored with to-dos (suggested), class suggested');
}
{
  const { library, state } = world({ env: { OPENAI_API_KEY: '' } });
  const { body } = await library.save(AUTH, { transcript: 'Notes from class about the French Revolution and its causes in 1789.', source: 'notes' });
  assert.equal(body.lecture.id, LECTURE);
  assert.equal(state.inserts.lecture.analysis.analyzed, false);
  assert.equal(state.inserts.lecture.source, 'notes');
  assert.ok(state.notes.find(item => item.content)?.content.includes('French Revolution'), 'the note still appears, with the transcript');
  console.log('ok   without AI the transcript is still saved');
}
{
  const { library, state } = world();
  const list = await library.list(AUTH);
  assert.deepEqual([list.body.enabled, list.body.lectures[0].summary, list.body.lectures[0].watch_count, list.body.lectures[0].todo_count], [true, 'Supply and demand set prices.', 1, 1]);
  assert.equal((await library.get(AUTH, LECTURE)).body.todos.length, 1);
  assert.equal((await library.get(AUTH, 'c0000000-0000-4000-8000-000000000999')).status, 404, "someone else's lecture");
  const confirmed = await library.todo(AUTH, { id: TODO, status: 'confirmed', due_date: '2026-10-25' });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(state.patches[0].body, { status: 'confirmed', due_at: '2026-10-25T23:59:00Z' });
  assert.ok(state.patches[0].url.includes(`user_id=eq.${USER}`), 'updates are limited to the student');
  assert.ok(state.urls.filter(url => url.includes('/rest/v1/')).every(url => url.includes(`user_id=eq.${USER}`) || url.startsWith('POST')), 'every read is filtered to the student');
  const todos = await library.todos(AUTH);
  assert.equal(todos.body.todos[0].lecture_title, 'Supply and Demand Basics');
  console.log('ok   list, open, confirm a to-do, calendar to-dos; always the student\'s own');
}
{
  const { library } = world({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
  assert.equal((await library.save(AUTH, { transcript: 'x'.repeat(100) })).status, 503);
  assert.deepEqual((await library.list(AUTH)).body, { enabled: false, lectures: [] });
  const signedOut = world().library;
  assert.equal((await signedOut.list('Bearer bad')).status, 401);
  console.log('ok   not set up and signed out');
}

{
  // A lecture saved before AI was set up gets its notes when it's opened.
  const { library, state } = world({ stored: { id: LECTURE, title: 'Supply and Demand Basics', folder_id: CLASS, lecture_date: '2026-10-17', transcript: '', segments: SEGMENTS, analysis: { analyzed: false, note_id: 'note-1' } } });
  const { status, body } = await library.analyze(AUTH, { id: LECTURE });
  assert.equal(status, 200);
  assert.equal(body.analysis.analyzed, true);
  assert.equal(body.analysis.outline[0].heading, 'Supply and demand');
  assert.equal(body.analysis.note_id, 'note-1', 'the same note is updated');
  assert.equal(state.notes.filter(item => item.created).length, 0);
  assert.ok(state.notes.at(-1).content.includes('Curves shift with conditions'));
  assert.equal(body.todos.length, 1);
  assert.equal(state.lecturePatches.at(-1).analysis.analyzed, true);
  const noAi = world({ env: { OPENAI_API_KEY: '' }, stored: { id: LECTURE, title: 'Old lecture', transcript: 'We talked about the causes of the French Revolution in 1789.', segments: [], analysis: { analyzed: false } } });
  const unset = await noAi.library.analyze(AUTH, { id: LECTURE });
  assert.equal(unset.body.reason, 'not_configured');
  assert.equal(unset.body.analysis.note_id, 'note-1', 'without AI the transcript still becomes a note');
  assert.equal((await world().library.analyze(AUTH, { id: 'nope' })).status, 404);
  console.log('ok   analyze: notes written on open, filed once in Notes');
}

{
  // "Open in Notes" never points at a deleted note: opening the lecture makes a new one.
  const done = { analyzed: true, summary: ['Kept.'], outline_md: '# Kept' };
  const gone = world({ stored: { id: LECTURE, title: 'Supply and Demand Basics', transcript: 'x', segments: [], analysis: { ...done, note_id: 'note-gone' } } });
  const remade = await gone.library.analyze(AUTH, { id: LECTURE });
  assert.equal(remade.body.analysis.note_id, 'note-1', 'a new note replaces the deleted one');
  assert.equal(gone.state.lecturePatches.at(-1).analysis.note_id, 'note-1');
  assert.ok(!gone.state.urls.includes('POST https://api.openai.com/v1/chat/completions'), 'no AI runs for an analyzed lecture');
  const kept = world({ stored: { id: LECTURE, title: 'Supply and Demand Basics', transcript: 'x', segments: [], analysis: { ...done, note_id: 'note-7' } } });
  assert.equal((await kept.library.analyze(AUTH, { id: LECTURE })).body.analysis.note_id, 'note-7');
  assert.equal(kept.state.notes.length, 0, 'a note that still exists is left alone');
  console.log('ok   analyze: a deleted lecture note is made again');
}

// Calendar: lecture to-dos join the Canvas feed without doubling an assignment Canvas already has.
const lectureItems = lectureCalendarItems([
  { id: '1', title: 'Problem set 3', due_at: '2026-10-24T23:59:00Z', lecture_id: LECTURE, lecture_title: 'Supply and Demand Basics', kind: 'assignment' },
  { id: '2', title: 'Read chapter 5', due_at: '2026-10-22T23:59:00Z', lecture_id: LECTURE, kind: 'reading' },
]);
assert.deepEqual(lectureItems[0], { id: 'lecture-1', title: 'Problem set 3', due_at: '2026-10-24T23:59:00Z', type: 'assignment', course: 'From Supply and Demand Basics', url: `/lecture/${LECTURE}`, internal: true });
const merged = mergeCalendarItems([{ id: 'c1', title: 'Problem Set 3 [ECON-101]', due_at: '2026-10-24T23:59:00Z' }], lectureItems);
assert.deepEqual(merged.map(item => item.id), ['c1', 'lecture-2']);
console.log('ok   calendar merge without duplicates');
console.log('lectures ok');
