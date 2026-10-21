import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINE_RULES, ANALYSIS_RULES, cleanSpeech, createLectureLibrary } from '../lib/server/lectureLibrary.mjs';
import { outlineHtml } from '../lib/lectureOutline.mjs';

const USER = '11111111-2222-4333-8444-555555555555';
const LECTURE = 'b0000000-0000-4000-8000-000000000001';
const AUTH = 'Bearer x.' + Buffer.from(JSON.stringify({ sub: USER })).toString('base64url') + '.sig';
const OUTLINE = '# Business Structures\n## I. Sole Proprietorship\n### A. Advantages\n* Easy and inexpensive to start\n   * Example: consulting work\n## II. Partnership\n1. General\n2. Limited';

test('speech-recognition noise is stripped before the AI reads it', () => {
  const raw = "I'm going to try this one. T-C- T-C- T-C- T-C- T-R-N-A-F. T-C- T-C. Q-i-i-i-i-i-i-i-i! All right........ ... Yeah, buddy. Yeah, buddy. Yeah, buddy. One per team? ? Late work is allowed.";
  assert.equal(cleanSpeech(raw), "I'm going to try this one. All right. Yeah, buddy. One per team? Late work is allowed.");
  assert.equal(cleanSpeech('A well-known self-paced e-mail course.'), 'A well-known self-paced e-mail course.', 'ordinary hyphenated words stay');
});

test('the outline renders as nested, escaped HTML', () => {
  const html = outlineHtml(OUTLINE + '\n* <script>alert(1)</script> **key**');
  assert.ok(html.startsWith('<h1>Business Structures</h1><h2>I. Sole Proprietorship</h2><h3>A. Advantages</h3><ul><li>Easy and inexpensive to start<ul><li>Example: consulting work</li></ul></li></ul>'));
  assert.ok(html.includes('<ol><li>General</li><li>Limited</li></ol>'));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('<strong>key</strong>'));
  assert.ok(!html.includes('<script>'));
});

function world({ stored } = {}) {
  const state = { calls: [], notes: [], inserts: {}, patches: [] };
  const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.endsWith('/billing/status')) return json({ plan: 'free' });
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      state.calls.push(body);
      const outline = body.messages[0].content === OUTLINE_RULES;
      return json({ choices: [{ finish_reason: 'stop', message: { content: outline ? '```markdown\n' + OUTLINE + '\n```' : JSON.stringify({ title: 'Forms of Business Ownership', summary: ['Three structures.'] }) } }] });
    }
    if (url.endsWith('/smart_notes') && method === 'POST') return json({ note: { id: 'note-1' } });
    if (url.includes('/smart_notes/') && method === 'PUT') { state.notes.push(JSON.parse(init.body)); return json({ ok: true }); }
    if (url.endsWith('/folders')) return json({ folders: [] });
    if (url.includes('/rest/v1/lectures') && method === 'POST') { state.inserts.lecture = JSON.parse(init.body); return json([{ id: LECTURE, ...state.inserts.lecture }], 201); }
    if (url.includes(`/rest/v1/lectures?id=eq.${LECTURE}`) && method === 'GET') return json([stored]);
    if (url.includes('/rest/v1/lectures?id=eq.') && method === 'PATCH') { state.patches.push(JSON.parse(init.body)); return json(null, 204); }
    if (url.includes('/rest/v1/lecture_todos')) return method === 'GET' ? json([]) : json(null, 201);
    throw new Error(`unexpected ${method} ${url}`);
  };
  const library = createLectureLibrary({
    env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', GROQ_API_KEY: 'gk' },
    fetch, today: () => new Date('2026-10-20T15:00:00Z'),
  });
  return { library, state };
}

const TRANSCRIPT = 'There are three basic ways to structure a business. '.repeat(10) + 'T-C- T-C- T-C- T-C- garbled.';

test('saving a lecture writes the full outline and makes it the note', async () => {
  const { library, state } = world();
  const { status } = await library.save(AUTH, { transcript: TRANSCRIPT, lecture_date: '2026-10-20' });
  assert.equal(status, 200);
  const outlineCall = state.calls.find(call => call.messages[0].content === OUTLINE_RULES);
  const analysisCall = state.calls.find(call => call.messages[0].content === ANALYSIS_RULES);
  assert.ok(outlineCall && analysisCall, 'outline and analysis are separate calls');
  assert.equal(outlineCall.reasoning_effort, 'low', "Groq's reasoning is kept low so the answer isn't cut off");
  assert.equal(outlineCall.max_tokens, 16000);
  assert.ok(!outlineCall.messages[1].content.includes('T-C-'), 'noise never reaches the model');
  assert.equal(state.inserts.lecture.analysis.outline_md, OUTLINE, 'code fences are removed');
  assert.equal(state.notes.at(-1).content, outlineHtml(OUTLINE), 'the note is the outline');
});

test('Make outline rewrites an older lecture without re-running its analysis', async () => {
  const stored = { id: LECTURE, title: 'Lecture Oct 20', lecture_date: '2026-10-20', transcript: TRANSCRIPT, segments: [], analysis: { analyzed: true, summary: ['Kept.'], note_id: 'note-1' } };
  const plain = world({ stored });
  const left = await plain.library.analyze(AUTH, { id: LECTURE });
  assert.equal(plain.state.calls.length, 0, 'opening an analyzed lecture costs nothing');
  assert.equal(left.body.analysis.outline_md, undefined);
  const { library, state } = world({ stored });
  const { body } = await library.analyze(AUTH, { id: LECTURE, rewrite: true });
  assert.deepEqual(state.calls.map(call => call.messages[0].content === OUTLINE_RULES), [true], 'only the outline is written');
  assert.equal(body.analysis.outline_md, OUTLINE);
  assert.deepEqual(body.analysis.summary, ['Kept.']);
  assert.equal(state.notes.at(-1).content, outlineHtml(OUTLINE));
  assert.equal(state.patches.at(-1).analysis.note_id, 'note-1');
});
