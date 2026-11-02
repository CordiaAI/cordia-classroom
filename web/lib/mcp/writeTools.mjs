// The write tools (MCP Phase 3). Add-only: answers are recorded, cards appended, notes and study sets
// created; nothing is deleted or overwritten. Every change is made by a database function that
// runs as the student (their connected-app token) and checks the study set is theirs
// (supabase/migrations/20261102120000_mcp_write_tools.sql). The study maths is the app's own:
// lib/studyAnswer.mjs (spaced review, Learn, Retain misses), lib/studyDays.mjs, the backend's
// generation pipeline and plan limits (create_study_set).
import * as z from 'zod';
import { addStudy, rowToDay } from '../studyDays.mjs';
import { applyAnswer, guideAfter, parseItemId, remainingDue, sourcesFor } from '../studyAnswer.mjs';
import { confidenceFor, itemFingerprint } from '../learningEvents.mjs';
import { markdownToOutline } from '../markdownOutline.mjs';
import { failure, notFound, ok, unavailable } from './output.mjs';
import { registerTools } from './register.mjs';
import { localDate, localDay, zonedIso } from './zoned.mjs';

const id = z.uuid();
const link = (ctx, path) => new URL(path, ctx.baseUrl).href;
const studySetUrl = (ctx, setId) => link(ctx, `/guide/${setId}`);

// A database function's refusal as a tool error (its messages are written for the student).
function refused(error, what) {
  if (error?.code === 'P0002') return notFound(what);
  if (error?.code === '22023') return failure(String(error.message || 'That input is not valid.').slice(0, 300), 'invalid_input');
  if (error?.code === '54000') return failure(String(error.message || 'That is too many for now. Try again later.').slice(0, 300), 'limit_reached');
  return unavailable(what);
}

// 9. record_answer -------------------------------------------------------------------------------
async function recordAnswer(ctx, { item_type, item_id, correct, confidence, response_text, idempotency_key, answered_at }) {
  const parsed = parseItemId(item_id);
  if (!parsed || (item_type === 'practice') !== (parsed.kind === 'practice')) {
    return failure('That item_id is not one Cordia gave. Use a card_id from get_due_cards, or a question_id, problem_id or card_id from get_study_set.', 'invalid_input');
  }
  const { data: guide, error } = await ctx.db.from('study_guides')
    .select('id, title, flashcards, flashcard_progress, quiz_questions, practice_state').eq('id', parsed.guideId).maybeSingle();
  if (error) return unavailable('study set');
  if (!guide) return notFound('study set');
  const today = localDay(new Date(), ctx.timeZone);
  const [{ data: missRow }, { data: dayRow }] = await Promise.all([
    ctx.db.from('retain_misses').select('items').eq('guide_id', guide.id).maybeSingle(),
    ctx.db.from('study_days').select('day, minutes, cards, right_count, total, guides').eq('day', today).maybeSingle(),
  ]);
  const misses = Array.isArray(missRow?.items) ? missRow.items : [];
  const sources = sourcesFor(guide, misses, parsed);
  if (!sources) return notFound('question');

  const change = applyAnswer(guide, misses, sources, { correct, confidence, today, on: localDate(new Date(), ctx.timeZone) });
  const kind = sources.practice !== undefined ? 'practice' : sources.index !== undefined ? 'cards' : 'quiz';
  const day = addStudy(rowToDay(dayRow), { guideId: guide.id, guideTitle: guide.title || '', cards: 1, right: correct ? 1 : 0, total: 1, kind });
  const after = guideAfter(guide, change);
  const result = {
    item_id,
    correct,
    next_due_on: change.nextDueOn,
    strength: change.strength,
    remaining_due_in_set: remainingDue(after, change.misses ?? misses, today),
    study_set: { id: guide.id, title: guide.title || 'Untitled' },
    url: link(ctx, `/session?guideId=${guide.id}`),
  };
  const { data: saved, error: saveError } = await ctx.db.rpc('mcp_record_answer', {
    answer_key: idempotency_key,
    guide: guide.id,
    cards: change.cards,
    learn: change.learn,
    misses: change.misses,
    practice: change.practice ? { ...change.practice, message: 'Answered in a connected AI app.' } : null,
    study_day: { day: today, minutes: day.m, cards: day.c, right_count: day.r, total: day.t, guides: day.g },
    result,
  });
  if (saveError) return refused(saveError, 'study set');

  // The answer log (adaptive engine), as the app logs answers, once per answer.
  if (!saved?.replayed && sources.front) {
    const format = kind === 'practice' ? 'practice' : kind === 'cards' ? 'flashcard' : 'typed';
    const outcome = format === 'flashcard' ? (correct ? 'got_it' : 'again') : (correct ? 'right' : 'wrong');
    await ctx.fetchBackend('/mcp/learning-events', {
      method: 'POST',
      body: { tz_offset: offsetMinutes(ctx.timeZone), events: [{ guide_id: guide.id, fingerprint: itemFingerprint(sources.front), format, outcome, confidence: confidenceFor(confidence), answer_chars: response_text ? response_text.length : null, occurred_at: answered_at || null }] },
    }).catch(() => null);
  }
  return ok({ ...result, ...(saved && typeof saved === 'object' ? saved : {}), replayed: Boolean(saved?.replayed) });
}

// Minutes east of UTC in the student's time zone, for the answer log's same-day marks.
function offsetMinutes(timeZone) {
  const match = String(zonedIso(new Date(), timeZone) || '').match(/([+-])(\d{2}):(\d{2})$/);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

// 10. create_study_set ---------------------------------------------------------------------------
async function createStudySet(ctx, { source, title, course_id, outputs }) {
  let response;
  try {
    response = await ctx.fetchBackend('/mcp/study-sets', { method: 'POST', body: { source, title: title || null, course_id: course_id || null, outputs: outputs || null } });
  } catch {
    return unavailable('Library');
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 402) {
    const detail = body?.detail || {};
    return failure(`${detail.message || 'You have used all your study sets for this month.'} Upgrade or check your plan: ${link(ctx, detail.upgrade_url || '/settings?section=subscription')}`, 'limit_reached');
  }
  if (response.status === 401) return failure('This app was disconnected from Cordia. Connect it again to continue.', 'unavailable');
  if (response.status === 404) return notFound('course');
  if (response.status === 422 || response.status === 429) {
    const detail = typeof body?.detail === 'string' ? body.detail : 'Cordia could not use that source. Paste the text instead.';
    return failure(detail, response.status === 429 ? 'limit_reached' : 'invalid_input');
  }
  if (!response.ok || !body?.job_id) return unavailable('Library');
  // The same request sent again returns the job already made for it, which may be further along.
  const status = ['queued', 'running', 'done'].includes(body.status) ? body.status : 'queued';
  return ok({
    job_id: body.job_id,
    status,
    estimated_seconds: status === 'done' ? 0 : 90,
    message: status === 'queued'
      ? 'Cordia is making the study set. Check on it with get_job_status in about a minute; it also shows in the student\'s Cordia app when it\'s ready.'
      : 'Cordia already has this request from the last few minutes, so it did not make a second study set. Check on it with get_job_status.',
  });
}

// 11. add_flashcards -----------------------------------------------------------------------------
async function addFlashcards(ctx, { study_set_id, cards }) {
  const { data, error } = await ctx.db.rpc('mcp_add_flashcards', { guide: study_set_id, cards });
  if (error) return refused(error, 'study set');
  const indexes = Array.isArray(data?.card_indexes) ? data.card_indexes : [];
  return ok({
    added_count: Number(data?.added_count) || 0,
    skipped_duplicates: Number(data?.skipped_duplicates) || 0,
    card_ids: indexes.map(index => `${study_set_id}:card:${index}`),
    url: link(ctx, `/flashcards/study?guideId=${study_set_id}`),
  });
}

// 12. save_note ----------------------------------------------------------------------------------
async function saveNote(ctx, { title, content, course_id, study_set_id }) {
  const notes = markdownToOutline(content);
  if (!notes) return failure('The note has no text to save.', 'invalid_input');
  const { data, error } = await ctx.db.rpc('mcp_save_note', { title: title.trim(), notes, course: course_id || null, study_set: study_set_id || null });
  if (error) return refused(error, error?.code === 'P0002' && course_id ? 'course or study set' : 'study set');
  return ok({ note_id: data, url: studySetUrl(ctx, data) });
}

// Definitions ------------------------------------------------------------------------------------
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const WRITE_TOOLS = [
  {
    name: 'record_answer',
    title: 'Record an answer',
    description: 'Records one answer and the student\'s confidence in Cordia\'s spaced review, Learn and progress, the same as answering in the app. An idempotency_key is only ever counted once.',
    annotations: { idempotentHint: true },
    input: {
      item_type: z.enum(['flashcard', 'quiz_question', 'practice']).describe('flashcard for card and learn_idea items; quiz_question for quiz questions and missed questions; practice for practice problems.'),
      item_id: z.string().min(40).max(500).describe('card_id from get_due_cards, or question_id, problem_id or card_id from get_study_set.'),
      correct: z.boolean(),
      confidence: z.enum(['sure', 'think', 'guess']).describe('How sure the student was before seeing the answer: sure, think (think so) or guess.'),
      response_text: z.string().max(1000).optional().describe('What the student answered. Only its length is kept.'),
      idempotency_key: z.string().min(1).max(200).describe('A new key for each answer; resending the same key never counts twice.'),
      answered_at: z.iso.datetime({ offset: true }).optional(),
    },
    output: {
      item_id: z.string(), correct: z.boolean(), next_due_on: z.string().nullable(), strength: z.string().nullable(),
      remaining_due_in_set: z.number().int().describe('Items still due today in this answer\'s study set (study_set), not across all sets; get_due_cards gives the total.'),
      study_set: z.object({ id: z.string(), title: z.string() }), url: z.string(), replayed: z.boolean(),
    },
    run: recordAnswer,
  },
  {
    name: 'create_study_set',
    title: 'Create a study set',
    description: 'Starts making a study set (notes, study guide and flashcards) from pasted text or a public web link, counted against the student\'s plan like the app. It returns a job_id at once; the set is usually ready in about a minute. Canvas and other LMS pages are not supported.',
    annotations: { idempotentHint: false },
    input: {
      source: z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string().min(40).max(200000) }).strict(),
        z.object({ type: z.literal('url'), url: z.url({ protocol: /^https?$/ }).max(2048) }).strict(),
      ]),
      title: z.string().min(1).max(200).optional(),
      course_id: id.optional(),
      outputs: z.array(z.enum(['notes', 'study_guide', 'flashcards'])).min(1).max(3).optional().describe('What to make; default all three. A study guide is always made.'),
    },
    output: { job_id: z.string(), status: z.enum(['queued', 'running', 'done']), estimated_seconds: z.number().int(), message: z.string() },
    run: createStudySet,
  },
  {
    name: 'add_flashcards',
    title: 'Add flashcards',
    description: 'Adds flashcards to one of the student\'s study sets, after the cards it already has. Cards the set already has are skipped, and existing cards are never changed or removed.',
    annotations: { idempotentHint: false },
    input: {
      study_set_id: id,
      cards: z.array(z.object({ front: z.string().min(1).max(500), back: z.string().min(1).max(2000) }).strict()).min(1).max(50),
    },
    output: { added_count: z.number().int(), skipped_duplicates: z.number().int(), card_ids: z.array(z.string()), url: z.string() },
    run: addFlashcards,
  },
  {
    name: 'save_note',
    title: 'Save a note',
    description: 'Saves a new note page (Markdown) in the student\'s Cordia Library, optionally in a course and next to a study set, labelled as added from this app. It always creates a new page and never edits an existing one.',
    annotations: { idempotentHint: false },
    input: {
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(50000).describe('Markdown: headings, bullet lists and **bold** carry over.'),
      course_id: id.optional(),
      study_set_id: id.optional(),
    },
    output: { note_id: z.string(), url: z.string() },
    run: saveNote,
  },
];

export function registerWriteTools(server, ctx) {
  registerTools(server, ctx, WRITE_TOOLS, WRITE, 'write');
}
