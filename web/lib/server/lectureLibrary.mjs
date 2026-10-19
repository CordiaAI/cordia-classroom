// Server-only: the Lectures section (/api/lectures/*). Lectures are transcripts (no audio is
// stored): a recording's transcript, an uploaded recording's, or notes / a transcript pasted in.
// Each one is read once by the AI for a summary, what to watch for, to-dos with dates, an
// outline, key terms and the professor's questions. Every watch-for item and to-do must quote
// the lecture, or it is dropped. To-dos reach Calendar and Today only once confirmed.
// Storage: tables lectures + lecture_todos (supabase/migrations/20261019120000_lectures.sql),
// read and written with the service role, always filtered to the signed-in student.
import { sensibleTitle } from '../noteMeta.mjs';

export const ANALYSIS_RULES = `You read a lecture (a transcript, or a student's notes from it) and pull out what the student needs. Use only what is in the text; never add outside knowledge.
Return JSON:
{"title": "...", "class_id": "<id or empty>",
 "summary": ["..."],
 "watch_for": [{"point": "...", "why": "exam" | "mistake" | "emphasis" | "requirement", "quote": "...", "at_ms": 0}],
 "todos": [{"title": "...", "kind": "assignment" | "reading" | "exam" | "other", "said": "...", "due_date": "YYYY-MM-DD or empty", "quote": "...", "at_ms": 0}],
 "outline": [{"heading": "...", "at_ms": 0, "points": ["..."]}],
 "terms": [{"term": "...", "definition": "...", "at_ms": 0}],
 "questions": [{"question": "...", "at_ms": 0}]}
- title: 3 to 8 words naming the subject, as a student would label it.
- summary: 3 to 5 points on what the lecture covered.
- watch_for: anything the speaker flags for a test, grade or requirement, calls a common mistake, says to remember, or repeats for emphasis. "point" says it plainly.
- todos: assignments, readings, exams and deadlines the speaker mentions. "said" is how the date was said ("next Friday"). Work out due_date from the lecture date given below; leave it empty if no date was given.
- quote: the speaker's exact words from the text, under 25 words. Required for watch_for and todos.
- outline: the lecture written up as notes: its sections in order, each with 3 to 8 points that together cover all of the information (definitions, explanations, causes and effects, steps, examples, comparisons). Points are complete statements in plain language.
- terms: terms the speaker defines or explains, with the definition as given.
- questions: questions the speaker asks the class.
- at_ms: the number in [brackets] at the start of the line it came from; 0 if the lines have no numbers.
- class_id: the id of the class whose name best matches the subject, or "" if none fits.
- Use empty lists when there is nothing of a kind.`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = text => String(text || '').toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}']+/gu) || [];

// A quote counts when its words appear, in order, in the lecture (punctuation and case ignored).
export function supported(quote, text) {
  const quoteWords = words(quote);
  if (quoteWords.length < 3) return false;
  return ` ${words(text).join(' ')} `.includes(` ${quoteWords.slice(0, 8).join(' ')} `);
}

const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function snap(at, starts) {
  const value = Math.max(0, Math.round(Number(at) || 0));
  if (!starts.length) return 0;
  return starts.filter(start => start <= value).pop() ?? starts[0];
}

// Keep only well-formed, supported items; cap every list.
export function cleanAnalysis(raw, { text, starts = [], classes = [] }) {
  const at = value => snap(value, starts);
  const watch = (raw.watch_for || []).filter(item => clip(item?.point, 300) && supported(item?.quote, text)).slice(0, 30)
    .map(item => ({ point: clip(item.point, 300), why: ['exam', 'mistake', 'emphasis', 'requirement'].includes(item.why) ? item.why : 'emphasis', quote: clip(item.quote, 300), at_ms: at(item.at_ms) }));
  const todos = (raw.todos || []).filter(item => clip(item?.title, 200) && supported(item?.quote, text)).slice(0, 20)
    .map(item => ({ title: clip(item.title, 200), kind: ['assignment', 'reading', 'exam', 'other'].includes(item.kind) ? item.kind : 'assignment', said: clip(item.said, 80), due_date: ISO_DATE.test(item.due_date || '') ? item.due_date : '', quote: clip(item.quote, 300), at_ms: at(item.at_ms) }));
  const outline = (raw.outline || []).filter(item => clip(item?.heading, 120)).slice(0, 20)
    .map(item => ({ heading: clip(item.heading, 120), at_ms: at(item.at_ms), points: (item.points || []).map(point => clip(point, 300)).filter(Boolean).slice(0, 10) }));
  const terms = (raw.terms || []).filter(item => clip(item?.term, 120) && clip(item?.definition, 400)).slice(0, 40)
    .map(item => ({ term: clip(item.term, 120), definition: clip(item.definition, 400), at_ms: at(item.at_ms) }));
  const questions = (raw.questions || []).filter(item => clip(item?.question, 300)).slice(0, 20)
    .map(item => ({ question: clip(item.question, 300), at_ms: at(item.at_ms) }));
  return {
    title: sensibleTitle(raw.title, text),
    class_id: classes.some(item => item.id === raw.class_id) ? raw.class_id : '',
    summary: (raw.summary || []).map(point => clip(point, 300)).filter(Boolean).slice(0, 6),
    watch_for: watch, todos, outline, terms, questions,
  };
}

// The lecture as the model reads it: "[start_ms] text" lines when there are timed segments.
export function lectureText(transcript, segments) {
  const timed = (segments || []).filter(item => String(item?.text || '').trim());
  return timed.length ? timed.map(item => `[${Math.round(item.start_ms || 0)}] ${String(item.text).trim()}`).join('\n') : String(transcript || '');
}

const escapeHtml = text => String(text || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// The lecture as a note for the Notes tab: summary, notes by section, what to watch for, key
// terms and to-dos. Without AI notes yet, the transcript itself in paragraphs.
export function lectureNoteHtml(lecture, analysis = {}, todos = []) {
  const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
  const parts = [];
  if (analysis.summary?.length) parts.push('<h2>Summary</h2>', list(analysis.summary.map(escapeHtml)));
  (analysis.outline || []).forEach(section => {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    if (section.points?.length) parts.push(list(section.points.map(escapeHtml)));
  });
  if (analysis.watch_for?.length) parts.push('<h2>What to watch for</h2>', list(analysis.watch_for.map(item => `<strong>${escapeHtml(item.point)}</strong>: “${escapeHtml(item.quote)}”`)));
  if (analysis.terms?.length) parts.push('<h2>Key terms</h2>', list(analysis.terms.map(item => `<strong>${escapeHtml(item.term)}</strong>: ${escapeHtml(item.definition)}`)));
  if (todos.length) parts.push('<h2>To do</h2>', list(todos.map(item => `${escapeHtml(item.title)}${item.said ? ` (${escapeHtml(item.said)})` : ''}`)));
  if (!parts.length) {
    const sentences = String(lecture.transcript || '').split(/(?<=[.!?])\s+/);
    const paragraphs = [];
    for (let i = 0; i < sentences.length; i += 5) paragraphs.push(sentences.slice(i, i + 5).join(' '));
    parts.push('<h2>Transcript</h2>', ...paragraphs.filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`));
  }
  return parts.join('');
}

export function createLectureLibrary({ env = process.env, fetch: fetchImpl = globalThis.fetch, today = () => new Date() } = {}) {
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const openaiKey = env.OPENAI_API_KEY || '';
  const model = env.CLASSROOM_LECTURE_CHAT_MODEL || 'gpt-4o-mini';
  const enabled = Boolean(supabaseUrl && serviceKey);
  const NOT_SET_UP = { status: 503, body: { detail: "Lectures aren't set up on this site yet.", code: 'not_configured' } };

  const db = (path, init = {}) => fetchImpl(`${supabaseUrl}/rest/v1${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  async function who(authorization) {
    if (!authorization) return '';
    const check = await fetchImpl(`${apiBase}/billing/status`, { headers: { Authorization: authorization } }).catch(() => null);
    if (!check?.ok) return '';
    try {
      const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
      return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
    } catch {
      return '';
    }
  }

  async function analyze(text, { lectureDate, classes }) {
    if (!openaiKey || text.trim().length < 40) return null;
    const date = new Date(`${lectureDate}T12:00:00Z`);
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 4000, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: ANALYSIS_RULES },
            { role: 'user', content: `Lecture date: ${lectureDate} (${weekday})\nClasses:\n${classes.map(item => `${item.id}: ${item.name}`).join('\n') || '(none)'}\n\nLecture:\n${text.slice(0, 80000)}` },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return JSON.parse((await response.json())?.choices?.[0]?.message?.content || '{}');
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function rows(path) {
    const response = await db(path).catch(() => null);
    if (!response?.ok) return null;
    return response.json();
  }

  // Every lecture has a note in the Notes tab (made with the student's own sign-in, filed in
  // the lecture's class). An existing note is refreshed when the AI notes arrive later.
  async function syncNote(authorization, lecture, analysis, todos) {
    const content = lectureNoteHtml(lecture, analysis, todos);
    const headers = { Authorization: authorization, 'Content-Type': 'application/json' };
    let noteId = analysis.note_id || '';
    if (!noteId) {
      const created = await fetchImpl(`${apiBase}/smart_notes`, { method: 'POST', headers, body: JSON.stringify({ title: lecture.title }) }).catch(() => null);
      noteId = created?.ok ? (await created.json())?.note?.id || '' : '';
      if (!noteId) return '';
    }
    await fetchImpl(`${apiBase}/smart_notes/${noteId}`, {
      method: 'PUT', headers, body: JSON.stringify({ title: lecture.title, content, ...(lecture.folder_id ? { folder_id: lecture.folder_id } : {}) }),
    }).catch(() => null);
    return noteId;
  }

  async function saveAnalysis(userId, lectureId, analysis) {
    await db(`/lectures?id=eq.${lectureId}&user_id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ analysis, updated_at: new Date().toISOString() }) }).catch(() => null);
  }

  async function insertTodos(userId, lectureId, todos) {
    if (!todos.length) return;
    await db('/lecture_todos', {
      method: 'POST',
      body: JSON.stringify(todos.map(item => ({ user_id: userId, lecture_id: lectureId, title: item.title, kind: item.kind, due_at: item.due_date ? `${item.due_date}T23:59:00Z` : null, said: item.said, quote: item.quote, at_ms: item.at_ms }))),
    }).catch(() => null);
  }

  // A lecture saved before its AI notes could be written gets them now (when it is opened).
  async function analyzeLecture(authorization, { id } = {}) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!UUID.test(id || '')) return { status: 404, body: { detail: 'Lecture not found.' } };
    const found = await rows(`/lectures?id=eq.${id}&user_id=eq.${userId}&select=*`);
    const lecture = found?.[0];
    if (!lecture) return { status: 404, body: { detail: 'Lecture not found.' } };
    const todosNow = async () => (await rows(`/lecture_todos?lecture_id=eq.${id}&user_id=eq.${userId}&status=neq.dismissed&select=id,title,kind,due_at,said,quote,at_ms,status&order=due_at.asc.nullslast`)) || [];
    // Without AI notes yet, the lecture still gets its note (the transcript) in the Notes tab.
    const keepNote = async (current, reason) => {
      const todos = await todosNow();
      let analysis = current;
      if (!current.note_id) {
        const noteId = await syncNote(authorization, lecture, current, todos);
        if (noteId) { analysis = { ...current, note_id: noteId }; await saveAnalysis(userId, id, analysis); }
      }
      return { status: 200, body: { analysis, todos, ...(reason ? { reason } : {}) } };
    };
    if (lecture.analysis?.analyzed) return keepNote(lecture.analysis);
    if (!openaiKey) return keepNote(lecture.analysis || {}, 'not_configured');
    const segments = lecture.segments || [];
    const text = lectureText(lecture.transcript, segments);
    const folders = await fetchImpl(`${apiBase}/folders`, { headers: { Authorization: authorization } }).then(response => (response.ok ? response.json() : null)).catch(() => null);
    const classes = (folders?.folders || []).map(item => ({ id: item.id, name: item.name }));
    const raw = await analyze(text, { lectureDate: lecture.lecture_date, classes });
    if (!raw) return keepNote(lecture.analysis || {}, 'failed');
    const analysis = cleanAnalysis(raw, { text, starts: segments.map(item => item.start_ms), classes });
    const { todos, title: _t, class_id: _c, ...stored } = analysis;
    const next = { ...stored, analyzed: true, note_id: lecture.analysis?.note_id || '' };
    await insertTodos(userId, id, todos);
    next.note_id = await syncNote(authorization, lecture, next, todos) || next.note_id;
    await saveAnalysis(userId, id, next);
    return { status: 200, body: { analysis: next, todos: await todosNow() } };
  }

  async function save(authorization, body = {}) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    const segments = Array.isArray(body.segments) ? body.segments.slice(0, 5000).map(item => ({ start_ms: Math.max(0, Math.round(Number(item.start_ms) || 0)), text: clip(item.text, 5000) })).filter(item => item.text) : [];
    const transcript = String(body.transcript || segments.map(item => item.text).join(' ')).slice(0, 500000).trim();
    if (transcript.length < 40) return { status: 400, body: { detail: 'There is not enough here to save as a lecture.' } };
    const lectureDate = ISO_DATE.test(body.lecture_date || '') ? body.lecture_date : today().toISOString().slice(0, 10);
    const classes = (Array.isArray(body.classes) ? body.classes : []).filter(item => UUID.test(item?.id || '')).slice(0, 200).map(item => ({ id: item.id, name: clip(item.name, 120) }));
    const text = lectureText(transcript, segments);
    const raw = await analyze(text, { lectureDate, classes });
    const analysis = raw ? cleanAnalysis(raw, { text, starts: segments.map(item => item.start_ms), classes }) : { summary: [], watch_for: [], todos: [], outline: [], terms: [], questions: [] };
    const folderId = UUID.test(body.folder_id || '') ? body.folder_id : analysis.class_id || null;
    const title = analysis.title || sensibleTitle(body.title, transcript) || `Lecture ${new Date(`${lectureDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    const source = ['recording', 'upload', 'notes'].includes(body.source) ? body.source : 'recording';
    const { todos, title: _t, class_id: _c, ...stored } = analysis;
    const created = await db('/lectures', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, folder_id: folderId, title, source, lecture_date: lectureDate, duration_ms: Math.max(0, Math.round(Number(body.duration_ms) || 0)), transcript, segments, analysis: { ...stored, analyzed: Boolean(raw) } }),
    }).catch(() => null);
    if (!created?.ok) return NOT_SET_UP;
    const lecture = (await created.json())?.[0];
    await insertTodos(userId, lecture.id, todos);
    // Notes always: the lecture's note goes into the Notes tab right away.
    const noteId = await syncNote(authorization, lecture, lecture.analysis || {}, todos);
    if (noteId) await saveAnalysis(userId, lecture.id, { ...(lecture.analysis || {}), note_id: noteId });
    return { status: 200, body: { lecture: { id: lecture.id, title } } };
  }

  async function list(authorization) {
    if (!enabled) return { status: 200, body: { enabled: false, lectures: [] } };
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    const lectures = await rows(`/lectures?user_id=eq.${userId}&select=id,title,folder_id,source,lecture_date,duration_ms,analysis,created_at&order=lecture_date.desc,created_at.desc&limit=500`);
    if (!lectures) return { status: 200, body: { enabled: false, lectures: [] } };
    const todos = (await rows(`/lecture_todos?user_id=eq.${userId}&status=in.(suggested,confirmed)&select=lecture_id,status`)) || [];
    return {
      status: 200,
      body: {
        enabled: true,
        lectures: lectures.map(({ analysis, ...item }) => ({
          ...item,
          summary: (analysis?.summary || [])[0] || '',
          watch_count: (analysis?.watch_for || []).length,
          todo_count: todos.filter(todo => todo.lecture_id === item.id).length,
        })),
      },
    };
  }

  async function get(authorization, id) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!UUID.test(id || '')) return { status: 404, body: { detail: 'Lecture not found.' } };
    const found = await rows(`/lectures?id=eq.${id}&user_id=eq.${userId}&select=*`);
    if (!found?.length) return { status: 404, body: { detail: 'Lecture not found.' } };
    const todos = (await rows(`/lecture_todos?lecture_id=eq.${id}&user_id=eq.${userId}&status=neq.dismissed&select=id,title,kind,due_at,said,quote,at_ms,status&order=due_at.asc.nullslast`)) || [];
    return { status: 200, body: { lecture: found[0], todos } };
  }

  async function update(authorization, { id, title, folder_id: folderId, lecture_date: lectureDate, guide_id: guideId } = {}) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!UUID.test(id || '')) return { status: 404, body: { detail: 'Lecture not found.' } };
    const patch = { updated_at: new Date().toISOString() };
    if (typeof title === 'string' && title.trim()) patch.title = clip(title, 200);
    if (folderId === '' || folderId === null) patch.folder_id = null;
    else if (UUID.test(folderId || '')) patch.folder_id = folderId;
    if (ISO_DATE.test(lectureDate || '')) patch.lecture_date = lectureDate;
    if (UUID.test(guideId || '')) patch.guide_id = guideId;
    const response = await db(`/lectures?id=eq.${id}&user_id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => null);
    return response?.ok ? { status: 200, body: { updated: true } } : { status: 404, body: { detail: 'Lecture not found.' } };
  }

  async function remove(authorization, { id } = {}) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!UUID.test(id || '')) return { status: 404, body: { detail: 'Lecture not found.' } };
    const response = await db(`/lectures?id=eq.${id}&user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => null);
    return response?.ok ? { status: 200, body: { deleted: true } } : { status: 404, body: { detail: 'Lecture not found.' } };
  }

  // Confirm, dismiss, mark done or change the date of a to-do.
  async function todo(authorization, { id, status, due_date: dueDate, title } = {}) {
    if (!enabled) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!UUID.test(id || '')) return { status: 404, body: { detail: 'To-do not found.' } };
    const patch = {};
    if (['suggested', 'confirmed', 'dismissed', 'done'].includes(status)) patch.status = status;
    if (dueDate === '') patch.due_at = null;
    else if (ISO_DATE.test(dueDate || '')) patch.due_at = `${dueDate}T23:59:00Z`;
    if (typeof title === 'string' && title.trim()) patch.title = clip(title, 200);
    const response = await db(`/lecture_todos?id=eq.${id}&user_id=eq.${userId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }).catch(() => null);
    if (!response?.ok) return { status: 404, body: { detail: 'To-do not found.' } };
    return { status: 200, body: { todo: (await response.json())?.[0] || null } };
  }

  // Confirmed to-dos with their lecture's title and class, for Calendar and Today.
  async function todos(authorization) {
    if (!enabled) return { status: 200, body: { todos: [] } };
    const userId = await who(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    const found = (await rows(`/lecture_todos?user_id=eq.${userId}&status=eq.confirmed&due_at=not.is.null&select=id,title,kind,due_at,lecture_id,lectures(title,folder_id)&order=due_at.asc&limit=200`)) || [];
    return { status: 200, body: { todos: found.map(({ lectures, ...item }) => ({ ...item, lecture_title: lectures?.title || '', folder_id: lectures?.folder_id || null })) } };
  }

  return { save, list, get, update, remove, todo, todos, analyze: analyzeLecture, enabled };
}
