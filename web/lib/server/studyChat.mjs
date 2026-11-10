// The chat workspace (/chat, prototype): Claude answers the student and calls Classroom's own
// tools. Read tools are the MCP server's (lib/mcp/readTools.mjs), run as the signed-in student so
// Row Level Security decides what they see. Each tool result that has something to look at comes
// back with a `window` the page opens beside the chat. Admin-only while it is a prototype.
import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod';
import { studentClient } from '../mcp/auth.mjs';
import { loadCourses } from '../mcp/courses.mjs';
import { mcpConfig } from '../mcp/config.mjs';
import { READ_TOOLS } from '../mcp/readTools.mjs';
import { zoneOf } from '../mcp/zoned.mjs';

export const CHAT_MODEL = 'claude-haiku-5-5';
const MAX_ROUNDS = 6;
const JOB_WAIT_MS = 100000;

// get_progress and get_job_status call /mcp/* backend routes that take connected-app tokens only.
const READS = READ_TOOLS.filter(tool => !['get_progress', 'get_job_status'].includes(tool.name));

// Which window each tool opens. Tools missing here only feed the model.
const WINDOW_FOR = {
  get_study_set: 'guide',
  get_due_cards: 'review',
  get_lecture: 'lecture',
  list_study_sets: 'library',
  search_my_materials: 'search',
  create_study_guide: 'guide',
  show_quiz: 'quiz',
  show_flashcards: 'flashcards',
};

const question = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer_index: z.number().int().min(0),
  explanation: z.string(),
});

// Tools that exist only for this page: building a guide through the app's own job route, and two
// windows the model fills in itself from material it has read.
const PAGE_TOOLS = [
  {
    name: 'create_study_guide',
    description: 'Builds a new Cordia study guide (notes, Q&A and flashcards) from text the student pasted, in one class. Counts against the plan\'s monthly guides. Takes up to a minute.',
    input: {
      title: z.string().min(1).max(200),
      text: z.string().min(200).max(200000).describe('The material, exactly as the student gave it.'),
      course_id: z.string().optional().describe('The class (course id) to file it in.'),
    },
    run: createStudyGuide,
  },
  {
    name: 'show_quiz',
    description: 'Opens an interactive multiple-choice quiz window. Write questions only from material you read with get_study_set or get_lecture in this chat; each needs one correct option and a short explanation.',
    input: {
      title: z.string().max(200),
      study_set_id: z.string().optional(),
      questions: z.array(question).min(1).max(15),
    },
    run: async (_ctx, args) => ({ shown: true, questions: args.questions.length }),
  },
  {
    name: 'show_flashcards',
    description: 'Opens a flashcard window the student flips through. Use cards from get_study_set (include flashcards) or get_due_cards; write new ones only from material you read in this chat.',
    input: {
      title: z.string().max(200),
      study_set_id: z.string().optional(),
      cards: z.array(z.object({ front: z.string(), back: z.string() })).min(1).max(60),
    },
    run: async (_ctx, args) => ({ shown: true, cards: args.cards.length }),
  },
];

export const TOOLS = [
  ...READS.map(tool => ({ name: tool.name, description: tool.description, input: tool.input, run: (ctx, args) => tool.run(ctx, args).then(unwrap) })),
  ...PAGE_TOOLS,
];

const SCHEMAS = new Map(TOOLS.map(tool => [tool.name, z.object(tool.input).strict()]));

// MCP tools answer { structuredContent } or { isError, content: [{ text }] }.
function unwrap(result) {
  if (result?.isError) return { error: result.content?.[0]?.text || 'That did not work.' };
  return result?.structuredContent ?? result;
}

export function toolDefinitions() {
  return TOOLS.map(tool => {
    const { $schema, ...schema } = z.toJSONSchema(SCHEMAS.get(tool.name), { io: 'input' });
    return { name: tool.name, description: tool.description, input_schema: schema };
  });
}

function systemPrompt(ctx, style) {
  return [
    'You are Cordia, the study partner inside Cordia Classroom. The student talks to you in a chat; their classes are projects and their study guides live inside them.',
    'Every Classroom feature is one of your tools. When the student wants to look at, study or practice something, call the tool that opens it: get_study_set opens the guide, show_quiz a quiz, show_flashcards flashcards, get_due_cards today\'s review, get_lecture lecture notes, create_study_guide makes a new guide from pasted material.',
    'Find ids with list_study_sets or search_my_materials before you ask the student for them. Never invent ids.',
    'Quiz questions and flashcards you write must come only from material you read in this chat. If you have not read the set yet, call get_study_set first (include quiz or flashcards when useful).',
    'Teach like a good tutor: short answers, plain words, one idea at a time, a question back when it helps. The window shows the details, so do not repeat its contents in the chat.',
    style ? `The student learns best by ${style}. Explain in that way when you teach.` : '',
    ctx.projectName ? `The student has the class "${ctx.projectName}" (course id ${ctx.projectId}) open. Prefer its material.` : '',
    `The student's time zone is ${ctx.timeZone}.`,
  ].filter(Boolean).join('\n');
}

const STYLE_WORDS = {
  visual: 'seeing it: diagrams, structure and spatial layout',
  auditory: 'hearing and talking it through',
  read_write: 'reading and writing: clear notes and lists',
  kinesthetic: 'doing: real-life examples and hands-on steps',
};

// The student behind a normal app sign-in, or null. Connected-app tokens are turned away earlier.
export async function studentFromToken(token, config = mcpConfig()) {
  if (!token) return null;
  const db = studentClient(config, token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return { db, userId: data.user.id, token };
}

// Prototype access: Classroom admins, plus the user ids in STUDY_CHAT_USER_IDS (comma-separated).
export async function mayUseChat({ db, userId }, env = process.env) {
  const listed = String(env.STUDY_CHAT_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (listed.includes(userId)) return true;
  const { data, error } = await db.rpc('is_admin');
  return !error && data === true;
}

export function chatContext({ db, userId, token }, { projectId, projectName } = {}, config = mcpConfig()) {
  let courses = null;
  return {
    db,
    userId,
    token,
    apiUrl: config.apiUrl,
    baseUrl: process.env.CLASSROOM_PUBLIC_URL || 'https://classroom.cordiaai.io',
    timeZone: 'UTC',
    projectId: projectId || null,
    projectName: projectName || null,
    courses: () => courses || (courses = loadCourses(db)),
  };
}

async function loadStudent(ctx) {
  const [profile, style] = await Promise.all([
    ctx.db.from('user_profiles').select('timezone').eq('id', ctx.userId).maybeSingle(),
    ctx.db.from('learning_preferences').select('style').eq('user_id', ctx.userId).maybeSingle(),
  ]);
  ctx.timeZone = zoneOf(profile.data?.timezone || 'UTC');
  return STYLE_WORDS[style.data?.style] || '';
}

async function backend(ctx, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${ctx.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// The app's own background job (POST /study-set-jobs), so plan limits and the generation
// pipeline are exactly the Create page's. Waits for it, then reads the guide back.
async function createStudyGuide(ctx, { title, text, course_id }) {
  const queued = await backend(ctx, '/study-set-jobs', {
    method: 'POST',
    body: { content: text, title, keep_title: true, notes: true, flashcards: true, source_type: 'chat', folder_id: course_id || null },
  });
  const jobId = queued.data?.job?.id;
  if (!jobId) return { error: typeof queued.data?.detail === 'string' ? queued.data.detail : queued.data?.detail?.message || 'Cordia could not start that guide.' };
  const until = Date.now() + JOB_WAIT_MS;
  while (Date.now() < until) {
    await wait(3000);
    const { data } = await backend(ctx, `/study-set-jobs/${jobId}`);
    if (data?.job?.status === 'failed') return { error: data.job.error || 'Cordia could not build a guide from that material.' };
    if (data?.job?.status === 'done' && data.guide?.id) {
      const read = READS.find(tool => tool.name === 'get_study_set');
      return unwrap(await read.run(ctx, { study_set_id: data.guide.id, include: ['notes', 'outline', 'key_terms', 'flashcards'] }));
    }
  }
  return { error: 'The guide is still building. It will be in the class when it is ready.' };
}

async function runTool(ctx, name, input) {
  const tool = TOOLS.find(item => item.name === name);
  if (!tool) return { error: `No tool called ${name}.` };
  const parsed = SCHEMAS.get(name).safeParse(input || {});
  if (!parsed.success) return { error: `Those inputs are not valid: ${parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; ')}` };
  try {
    return await tool.run(ctx, parsed.data);
  } catch (error) {
    console.error('[study-chat] tool failed', name, error?.message || error);
    return { error: 'Something went wrong in Cordia. Try again in a moment.' };
  }
}

// One student turn: Claude and the tools take turns until Claude answers in words. `emit` gets
// { type: 'text' | 'tool' | 'window' | 'done' | 'error', ... } events as they happen.
export async function runChatTurn(ctx, messages, emit, { apiKey = process.env.ANTHROPIC_API_KEY, client } = {}) {
  if (!apiKey && !client) {
    emit({ type: 'error', message: 'The chat needs ANTHROPIC_API_KEY on this deployment.' });
    return;
  }
  const anthropic = client || new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 });
  const style = await loadStudent(ctx);
  const tools = toolDefinitions();
  const history = messages.map(message => ({ role: message.role, content: message.content }));
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: systemPrompt(ctx, style) }],
      tools,
      messages: history,
    });
    usage.input_tokens += reply.usage?.input_tokens || 0;
    usage.output_tokens += reply.usage?.output_tokens || 0;
    history.push({ role: 'assistant', content: reply.content });
    for (const block of reply.content) if (block.type === 'text' && block.text.trim()) emit({ type: 'text', text: block.text });

    const calls = reply.content.filter(block => block.type === 'tool_use');
    if (reply.stop_reason !== 'tool_use' || !calls.length) {
      emit({ type: 'done', usage, history });
      return;
    }
    const results = [];
    for (const call of calls) {
      emit({ type: 'tool', id: call.id, name: call.name, status: 'running' });
      const result = await runTool(ctx, call.name, call.input);
      const failed = Boolean(result?.error);
      emit({ type: 'tool', id: call.id, name: call.name, status: failed ? 'error' : 'done', error: failed ? result.error : undefined });
      const kind = WINDOW_FOR[call.name];
      if (kind && !failed) emit({ type: 'window', id: call.id, kind, data: kind === 'quiz' || kind === 'flashcards' ? call.input : result });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 20000), ...(failed ? { is_error: true } : {}) });
    }
    history.push({ role: 'user', content: results });
  }
  emit({ type: 'text', text: 'I stopped there to keep this quick. Ask me to keep going.' });
  emit({ type: 'done', usage, history });
}

// The sidebar: classes (projects) with their study guides, newest first.
export async function loadWorkspace(ctx) {
  const [folders, guides] = await Promise.all([
    ctx.db.from('folders').select('id, name, own_name, created_at').order('created_at', { ascending: true }).limit(200),
    ctx.db.from('study_guides').select('id, title, folder_id, created_at').order('created_at', { ascending: false }).limit(300),
  ]);
  if (folders.error || guides.error) throw folders.error || guides.error;
  const byFolder = new Map();
  for (const guide of guides.data || []) {
    const key = guide.folder_id || 'none';
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push({ id: guide.id, title: guide.title || 'Untitled', created_at: guide.created_at });
  }
  const projects = (folders.data || []).map(folder => ({ id: folder.id, name: folder.own_name || folder.name || 'Class', guides: byFolder.get(folder.id) || [] }));
  const loose = byFolder.get('none') || [];
  return { projects, loose };
}
