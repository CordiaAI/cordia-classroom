// Lecture recording API (see lib/server/lectures.mjs).
//   GET  /api/lectures/usage
//   POST /api/lectures/chunk?recording_id=&seq=&start_ms=&duration_ms=&keep=  (body: raw audio; header X-Prompt: base64 text)
//   POST /api/lectures/notes  { segments, classes }
//   POST /api/lectures/title  { text }
// The Lectures section (lib/server/lectureLibrary.mjs):
//   GET  /api/lectures/list            GET /api/lectures/get?id=       GET /api/lectures/todos
//   POST /api/lectures/save            POST /api/lectures/update       POST /api/lectures/delete
//   POST /api/lectures/todo            POST /api/lectures/analyze { id }  (AI notes for a lecture saved without them)
// Server env: OPENAI_API_KEY (transcription, analysis), SUPABASE_SERVICE_ROLE_KEY (storage, metering).
import { MAX_CHUNK_BYTES, createLectureService } from '../../../lib/server/lectures.mjs';
import { createLectureLibrary } from '../../../lib/server/lectureLibrary.mjs';

const LIBRARY_GET = { list: 'list', get: 'get', todos: 'todos' };
const LIBRARY_POST = { save: 'save', update: 'update', delete: 'remove', todo: 'todo', analyze: 'analyze' };

export const config = { api: { bodyParser: false }, maxDuration: 60 };

async function readBody(req, limit) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) return null;
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const service = createLectureService();
  const authorization = req.headers.authorization || '';
  const { action } = req.query;
  try {
    let result;
    if (action === 'usage' && req.method === 'GET') {
      result = await service.usage(authorization);
    } else if (action === 'chunk' && req.method === 'POST') {
      const audio = await readBody(req, MAX_CHUNK_BYTES);
      if (!audio) return res.status(413).json({ detail: 'This part of the recording is too large.' });
      let prompt = '';
      try { prompt = Buffer.from(String(req.headers['x-prompt'] || ''), 'base64').toString('utf8'); } catch { prompt = ''; }
      result = await service.chunk(authorization, {
        audio,
        contentType: req.headers['content-type'] || '',
        recordingId: String(req.query.recording_id || ''),
        seq: Number(req.query.seq) || 0,
        startMs: Number(req.query.start_ms) || 0,
        durationMs: Number(req.query.duration_ms) || 0,
        keep: req.query.keep === '1',
        prompt,
      });
    } else if (LIBRARY_GET[action] && req.method === 'GET') {
      const library = createLectureLibrary();
      result = action === 'get' ? await library.get(authorization, String(req.query.id || '')) : await library[LIBRARY_GET[action]](authorization);
    } else if (LIBRARY_POST[action] && req.method === 'POST') {
      const raw = await readBody(req, 6_000_000);
      let body = {};
      try { body = JSON.parse(raw?.toString('utf8') || '{}'); } catch { body = {}; }
      result = await createLectureLibrary()[LIBRARY_POST[action]](authorization, body);
    } else if ((action === 'notes' || action === 'title') && req.method === 'POST') {
      const raw = await readBody(req, 2_000_000);
      let body = {};
      try { body = JSON.parse(raw?.toString('utf8') || '{}'); } catch { body = {}; }
      result = action === 'notes' ? await service.notes(authorization, body) : await service.title(authorization, body);
    } else {
      return res.status(404).json({ detail: 'Not found' });
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[lectures]', action, error?.message || error);
    return res.status(502).json({ detail: "Couldn't reach transcription. It will be retried." });
  }
}
