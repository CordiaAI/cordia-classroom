// The chat workspace's API (pages/chat.js, prototype). GET: the student's classes and guides.
// POST { messages, projectId?, projectName? }: one chat turn, streamed as newline-delimited JSON
// events (lib/server/studyChat.mjs runChatTurn).
import { withAppTokensOnly } from '../../lib/server/connectedApps.mjs';
import { chatContext, loadWorkspace, mayUseChat, runChatTurn, studentFromToken } from '../../lib/server/studyChat.mjs';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 300 };

const MAX_MESSAGES = 60;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let student;
  try {
    student = await studentFromToken(token);
    if (student && !(await mayUseChat(student))) return res.status(403).json({ detail: 'The chat workspace is a prototype and is not on for this account yet.' });
  } catch (error) {
    console.error('[study-chat] sign-in check', error?.message || error);
    return res.status(503).json({ detail: 'Cordia could not check your sign-in. Try again.' });
  }
  if (!student) return res.status(401).json({ detail: 'Sign in to Cordia Classroom first.' });

  if (req.method === 'GET') {
    try {
      return res.status(200).json(await loadWorkspace(chatContext(student)));
    } catch (error) {
      console.error('[study-chat] workspace', error?.message || error);
      return res.status(503).json({ detail: 'Could not load your classes.' });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const { messages, projectId, projectName } = req.body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) {
    return res.status(422).json({ detail: 'Send the conversation as a list of messages.' });
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
  const emit = event => res.write(JSON.stringify(event) + '\n');
  try {
    await runChatTurn(chatContext(student, { projectId, projectName }), messages, emit);
  } catch (error) {
    console.error('[study-chat] turn', error?.status || '', error?.message || error);
    emit({ type: 'error', message: 'Cordia could not answer just now. Try again.' });
  }
  res.end();
}

export default withAppTokensOnly(handler);
