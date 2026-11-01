// The read tools (MCP Phase 2). Every query goes through `ctx.db`, a Supabase client acting as the
// student (their connected-app token), so Row Level Security and the connected-app role's column
// grants decide what can be read: own rows only, never the columns that hold Canvas data, never
// guides built from a Canvas assignment. The logic is the app's own (lib/studyQueue.mjs,
// lib/guideText.mjs, lib/spacedReview.mjs, lib/streak.mjs, the backend's Progress functions).
import * as z from 'zod';
import { buildStudyQueue } from '../studyQueue.mjs';
import { parseQAPairs, parseStudyNotes } from '../guideText.mjs';
import { cardDue } from '../spacedReview.mjs';
import { itemFingerprint } from '../learningEvents.mjs';
import { conceptAnswer } from '../retainEngine.mjs';
import { questionKey } from '../retainMisses.mjs';
import { freezeStreak, semesterStart } from '../streak.mjs';
import { loadCourses } from './courses.mjs';
import { clip, decodeCursor, encodeCursor, failure, fitItems, notFound, ok, unavailable } from './output.mjs';
import { localDate, localDay, zonedIso } from './zoned.mjs';

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const id = z.uuid();
const course = z.object({ id: z.string(), name: z.string(), example_study_sets: z.array(z.string()).optional() }).nullable();
const KINDS = ['note', 'lecture', 'study_guide', 'flashcard'];

const link = (ctx, path) => new URL(path, ctx.baseUrl).href;
const studySetUrl = (ctx, setId) => link(ctx, `/guide/${setId}`);
const lectureUrl = (ctx, lectureId) => link(ctx, `/lecture/${lectureId}`);
const escapeLike = text => String(text).replace(/[\\%_*]/g, ' ').trim();

function searchUrl(ctx, hit) {
  if (hit.kind === 'flashcard') return link(ctx, `/flashcards/study?guideId=${hit.id}`);
  if (hit.kind === 'note') return link(ctx, `/smartnotes?id=${hit.id}`);
  if (hit.kind === 'lecture') return lectureUrl(ctx, hit.id);
  return studySetUrl(ctx, hit.id);
}

// 1. search_my_materials --------------------------------------------------------------------------
async function searchMyMaterials(ctx, { query, course_id, kinds, limit }) {
  const { data, error } = await ctx.db.rpc('search_my_materials', { search: query, course: course_id || null, kinds: kinds?.length ? kinds : null, max_results: limit });
  if (error) return unavailable('material');
  const courses = await ctx.courses();
  const results = (data || []).map(hit => ({
    kind: hit.kind,
    id: hit.id,
    title: hit.title || 'Untitled',
    course: courses.get(hit.course_id),
    snippet: clip(hit.snippet, 800),
    ...(hit.kind === 'lecture' ? { timestamp_seconds: hit.timestamp_seconds ?? null } : {}),
    ...(hit.kind === 'flashcard' ? { card_index: hit.card_index } : {}),
    url: searchUrl(ctx, hit),
  }));
  const { data: out, kept } = fitItems(results, items => ({ query, results: items, truncated: false }));
  if (kept < results.length) out.truncated = true;
  return ok(out);
}

// 2. list_study_sets ---------------------------------------------------------------------------
const SET_COLUMNS = 'id, title, folder_id, created_at, source_type, flashcards, quiz_questions, practice_state';
const STUDY_SET_STATUS = 'ready';

async function listStudySets(ctx, { course_id, query, cursor, limit }) {
  const state = decodeCursor(cursor);
  if (!state) return failure('That cursor is not valid. Call list_study_sets again without a cursor.');
  let request = ctx.db.from('study_guides').select(SET_COLUMNS).order('created_at', { ascending: false }).order('id').range(state.o, state.o + limit);
  if (course_id) request = request.eq('folder_id', course_id);
  if (query && escapeLike(query)) request = request.ilike('title', `%${escapeLike(query)}%`);
  const { data, error } = await request;
  if (error) return unavailable('study sets');
  const courses = await ctx.courses();
  const rows = (data || []).slice(0, limit);
  const sets = rows.map(row => {
    const cards = Array.isArray(row.flashcards) ? row.flashcards.length : 0;
    return {
      id: row.id,
      title: row.title || 'Untitled',
      course: courses.get(row.folder_id),
      created_at: zonedIso(row.created_at, ctx.timeZone),
      source_type: row.source_type || 'unknown',
      card_count: cards,
      has_quiz: Array.isArray(row.quiz_questions) && row.quiz_questions.length > 0,
      has_practice: Array.isArray(row.practice_state?.problems) && row.practice_state.problems.length > 0,
      // Imported pages carry only notes until they're opened in Cordia, which builds the cards.
      status: cards > 0 ? STUDY_SET_STATUS : 'notes_only',
      url: studySetUrl(ctx, row.id),
    };
  });
  const { data: out, kept } = fitItems(sets, items => ({ study_sets: items, next_cursor: null }));
  const more = kept < sets.length || (data || []).length > limit;
  out.next_cursor = more ? encodeCursor({ o: state.o + kept }) : null;
  return ok(out);
}

// 3. get_study_set -----------------------------------------------------------------------------
const SECTIONS = ['notes', 'outline', 'key_terms', 'flashcards', 'quiz', 'practice'];

function keyTerms(notes) {
  const terms = new Map();
  for (const section of notes.sections) {
    for (const point of section.points) {
      for (const match of point.text.matchAll(/\*\*([^*]{2,80})\*\*/g)) {
        const term = match[1].trim();
        if (!terms.has(term.toLowerCase())) terms.set(term.toLowerCase(), { term, context: clip(point.text.replace(/\*\*/g, ''), 300) });
      }
    }
  }
  return [...terms.values()];
}

function sectionItems(guide, name, today) {
  const notes = parseStudyNotes(guide.notes);
  if (name === 'notes') {
    const text = clip(guide.notes || parseQAPairs(guide.study_guide).map(pair => `- ${pair.answer}`).join('\n'), 60000);
    return text ? text.split(/\n(?=## )/).map(chunk => ({ text: chunk })) : [];
  }
  if (name === 'outline') return notes.sections.map(section => ({ heading: section.heading, points: section.points.map(point => clip(point.text, 600)) }));
  if (name === 'key_terms') return keyTerms(notes);
  if (name === 'flashcards') {
    return (Array.isArray(guide.flashcards) ? guide.flashcards : []).map((card, index) => ({
      card_id: `${guide.id}:card:${index}`,
      front: clip(card.front, 500),
      back: clip(card.back, 2000),
      due_on: cardDue(guide.flashcard_progress, index) || today,
    }));
  }
  if (name === 'quiz') {
    return (Array.isArray(guide.quiz_questions) ? guide.quiz_questions : []).map((question, index) => ({
      question_id: `${guide.id}:quiz:${index}`,
      question: clip(question.question, 600),
      options: Array.isArray(question.options) ? question.options.map(option => clip(option, 300)) : [],
      answer: clip(conceptAnswer(question), 600),
    }));
  }
  const evaluations = guide.practice_state?.progress?.evaluations || {};
  return (Array.isArray(guide.practice_state?.problems) ? guide.practice_state.problems : []).map((problem, index) => ({
    problem_id: `${guide.id}:practice:${index}`,
    prompt: clip(problem.prompt, 1500),
    answer: clip(problem.answer, 1500),
    solved: evaluations[index]?.status === 'correct',
  }));
}

async function getStudySet(ctx, { study_set_id, include, cursor }) {
  const state = decodeCursor(cursor);
  if (!state) return failure('That cursor is not valid. Call get_study_set again without a cursor.');
  const { data: guide, error } = await ctx.db.from('study_guides')
    .select('id, title, folder_id, created_at, source_type, notes, study_guide, flashcards, flashcard_progress, quiz_questions, practice_state')
    .eq('id', study_set_id).maybeSingle();
  if (error) return unavailable('study set');
  if (!guide) return notFound('study set');
  const courses = await ctx.courses();
  const wanted = SECTIONS.filter(name => (include?.length ? include : ['notes', 'outline', 'key_terms']).includes(name));
  const today = localDay(new Date(), ctx.timeZone);
  // One list across the requested sections, so a cursor can resume mid-section.
  const items = wanted.flatMap(name => sectionItems(guide, name, today).map(item => ({ name, item })));
  const rest = items.slice(state.o);
  const build = list => {
    const sections = Object.fromEntries(wanted.map(name => [name, []]));
    for (const { name, item } of list) sections[name].push(item);
    return {
      id: guide.id,
      title: guide.title || 'Untitled',
      course: courses.get(guide.folder_id),
      created_at: zonedIso(guide.created_at, ctx.timeZone),
      url: studySetUrl(ctx, guide.id),
      sections,
      truncated: false,
      next_cursor: null,
    };
  };
  const { data: out, kept } = fitItems(rest, build);
  if (kept < rest.length) {
    out.truncated = true;
    out.next_cursor = encodeCursor({ o: state.o + Math.max(kept, 1) });
  }
  return ok(out);
}

// 4. list_lectures -----------------------------------------------------------------------------
async function listLectures(ctx, { course_id, cursor, limit }) {
  const state = decodeCursor(cursor);
  if (!state) return failure('That cursor is not valid. Call list_lectures again without a cursor.');
  let request = ctx.db.from('lectures').select('id, title, folder_id, lecture_date, duration_ms, created_at, summary:analysis->summary')
    .order('created_at', { ascending: false }).order('id').range(state.o, state.o + limit);
  if (course_id) request = request.eq('folder_id', course_id);
  const { data, error } = await request;
  if (error) return unavailable('lectures');
  const courses = await ctx.courses();
  const lectures = (data || []).slice(0, limit).map(row => ({
    id: row.id,
    title: row.title || 'Lecture',
    course: courses.get(row.folder_id),
    recorded_at: row.lecture_date || zonedIso(row.created_at, ctx.timeZone),
    duration_seconds: row.duration_ms ? Math.round(row.duration_ms / 1000) : null,
    has_summary: Array.isArray(row.summary) && row.summary.length > 0,
    url: lectureUrl(ctx, row.id),
  }));
  const { data: out, kept } = fitItems(lectures, items => ({ lectures: items, next_cursor: null }));
  out.next_cursor = kept < lectures.length || (data || []).length > limit ? encodeCursor({ o: state.o + kept }) : null;
  return ok(out);
}

// 5. get_lecture -------------------------------------------------------------------------------
const WHY = { exam: 'On the exam', mistake: 'Common mistake', emphasis: 'Stressed', requirement: 'Required' };
const seconds = ms => (Number.isFinite(Number(ms)) && ms !== null ? Math.round(Number(ms) / 1000) : null);

async function getLecture(ctx, { lecture_id, include_transcript, cursor }) {
  const state = decodeCursor(cursor);
  if (!state) return failure('That cursor is not valid. Call get_lecture again without a cursor.');
  const columns = 'id, title, folder_id, lecture_date, duration_ms, created_at, analysis' + (include_transcript ? ', segments, transcript' : '');
  const { data: lecture, error } = await ctx.db.from('lectures').select(columns).eq('id', lecture_id).maybeSingle();
  if (error) return unavailable('lecture');
  if (!lecture) return notFound('lecture');
  const { data: todos } = await ctx.db.from('lecture_todos').select('title, kind, due_at, quote, at_ms, status').eq('lecture_id', lecture_id).neq('status', 'dismissed').limit(50);
  const courses = await ctx.courses();
  const analysis = lecture.analysis && typeof lecture.analysis === 'object' ? lecture.analysis : {};
  const legacyOutline = Array.isArray(analysis.outline) ? analysis.outline.map(part => `## ${part.heading}\n${(part.points || []).map(point => `- ${point}`).join('\n')}`).join('\n') : '';
  const base = {
    id: lecture.id,
    title: lecture.title || 'Lecture',
    course: courses.get(lecture.folder_id),
    recorded_at: lecture.lecture_date || zonedIso(lecture.created_at, ctx.timeZone),
    duration_seconds: seconds(lecture.duration_ms),
    url: lectureUrl(ctx, lecture.id),
    summary: (Array.isArray(analysis.summary) ? analysis.summary : []).map(point => clip(point, 500)),
    outline: clip(analysis.outline_md || legacyOutline, 8000),
    watch_for: (Array.isArray(analysis.watch_for) ? analysis.watch_for : []).map(item => ({
      quote: clip(item.quote, 400), timestamp_seconds: seconds(item.at_ms), note: clip([WHY[item.why], item.point].filter(Boolean).join(': '), 400),
    })),
    todos: (todos || []).map(todo => ({ text: clip(todo.title, 300), kind: todo.kind || 'other', due_date: todo.due_at ? String(todo.due_at).slice(0, 10) : null, timestamp_seconds: seconds(todo.at_ms) })),
    key_terms: (Array.isArray(analysis.terms) ? analysis.terms : []).map(term => ({ term: clip(term.term, 120), definition: clip(term.definition, 500), timestamp_seconds: seconds(term.at_ms) })),
    practice_questions: (Array.isArray(analysis.questions) ? analysis.questions : []).map(question => ({ question: clip(question.question, 500), timestamp_seconds: seconds(question.at_ms) })),
    student_notes: clip(analysis.my_notes || '', 6000),
  };
  if (!include_transcript) return ok({ ...base, transcript: null, next_cursor: null });
  const segments = Array.isArray(lecture.segments) && lecture.segments.length
    ? lecture.segments.map(segment => ({ timestamp_seconds: seconds(segment.start_ms), text: clip(segment.text, 2000) }))
    : (lecture.transcript ? [{ timestamp_seconds: 0, text: clip(lecture.transcript, 200000) }] : []);
  const rest = segments.slice(state.o);
  const { data: out, kept } = fitItems(rest, list => ({ ...base, transcript: list, next_cursor: null }));
  if (kept < rest.length) out.next_cursor = encodeCursor({ o: state.o + Math.max(kept, 1) });
  return ok(out);
}

// 6. get_due_cards -----------------------------------------------------------------------------
const CONFIDENCE = { sure: 'sure', think_so: 'think', guess: 'guess' };
const WRONG = new Set(['wrong', 'again']);

function itemId(item) {
  if (item.index !== undefined) return `${item.guideId}:card:${item.index}`;
  if (item.concept !== undefined) return `${item.guideId}:idea:${item.concept}`;
  return `${item.guideId}:miss:${encodeURIComponent(questionKey(item.front)).slice(0, 200)}`;
}

async function getDueCards(ctx, { study_set_id, course_id, limit }) {
  let request = ctx.db.from('study_guides').select('id, title, folder_id, flashcards, flashcard_progress, quiz_questions').order('created_at', { ascending: false });
  if (study_set_id) request = request.eq('id', study_set_id);
  else if (course_id) request = request.eq('folder_id', course_id);
  const { data: guides, error } = await request.limit(100);
  if (error) return unavailable('flashcards');
  if (study_set_id && !guides?.length) return notFound('study set');
  const ids = (guides || []).map(guide => guide.id);
  const [{ data: missRows }, { data: events }] = ids.length ? await Promise.all([
    ctx.db.from('retain_misses').select('guide_id, items').in('guide_id', ids),
    ctx.db.from('learning_events').select('guide_id, item_id, outcome, confidence, occurred_at').in('guide_id', ids).order('occurred_at', { ascending: false }).limit(3000),
  ]) : [{ data: [] }, { data: [] }];
  const stored = Object.fromEntries((missRows || []).map(row => [row.guide_id, row.items]));
  const today = localDay(new Date(), ctx.timeZone);
  // Exactly the app's Study now order: sure misses, due cards, Learn ideas, other misses.
  const { items } = buildStudyQueue(guides || [], stored, { guideId: study_set_id || '', today });
  const history = new Map();
  for (const event of events || []) {
    const key = `${event.guide_id}\n${event.item_id}`;
    const entry = history.get(key) || { confidence: null, wrong: 0 };
    if (entry.confidence === null && event.confidence) entry.confidence = CONFIDENCE[event.confidence] || null;
    if (WRONG.has(event.outcome)) entry.wrong += 1;
    history.set(key, entry);
  }
  const byId = new Map((guides || []).map(guide => [guide.id, guide]));
  const courses = await ctx.courses();
  const cards = items.slice(0, limit).map(item => {
    const guide = byId.get(item.guideId);
    const seen = history.get(`${item.guideId}\n${itemFingerprint(item.front)}`) || { confidence: null, wrong: 0 };
    return {
      card_id: itemId(item),
      kind: item.index !== undefined ? 'flashcard' : item.concept !== undefined ? 'learn_idea' : 'missed_question',
      study_set: { id: item.guideId, title: guide?.title || 'Untitled', course: courses.get(guide?.folder_id) },
      front: clip(item.front, 500),
      back: clip(item.back, 2000),
      due_on: item.index !== undefined ? (cardDue(guide?.flashcard_progress, item.index) || today) : today,
      last_confidence: seen.confidence || (item.sure ? 'sure' : null),
      times_wrong: seen.wrong,
      missed_while_sure: Boolean(item.sure),
    };
  });
  const { data: out } = fitItems(cards, list => ({ total_due: items.length, today, cards: list, url: link(ctx, study_set_id ? `/session?guideId=${study_set_id}` : '/session') }));
  return ok(out);
}

// 7. get_progress ------------------------------------------------------------------------------
async function getProgress(ctx, { course_id, range }) {
  const now = new Date();
  const today = localDate(now, ctx.timeZone);
  const since = range === 'semester' ? semesterStart(today) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - (range === '7d' ? 6 : 29));
  const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const query = new URLSearchParams({ since: sinceKey, ...(course_id ? { course_id } : {}) });
  let summary;
  try {
    const response = await ctx.fetchBackend(`/mcp/progress?${query}`);
    if (response.status === 401) return failure('This app was disconnected from Cordia. Connect it again to continue.');
    if (!response.ok) return unavailable('progress');
    summary = await response.json();
  } catch {
    return unavailable('progress');
  }
  // The app's streak counts days in the study log too, with one forgiven day a week (lib/streak.mjs).
  const { data: days } = await ctx.db.from('study_days').select('day, minutes, cards, total').gte('day', localDay(new Date(now.getTime() - 400 * 86400000), ctx.timeZone));
  const active = new Set((days || []).filter(day => day.minutes > 0 || day.cards > 0 || day.total > 0).map(day => day.day));
  (summary.week || []).forEach(day => { if (day.active) active.add(day.date); });
  const streak = freezeStreak(active, today);
  const courses = await ctx.courses();
  return ok({
    range,
    since: sinceKey,
    time_zone: ctx.timeZone,
    course: course_id ? courses.get(course_id) : null,
    streak_days: Math.max(streak.days, summary.streak_days || 0),
    studied_today: streak.today || Boolean(summary.studied_today),
    active_study_minutes: summary.active_study_minutes || 0,
    quiz_accuracy_trend: (summary.quiz_accuracy_trend || []).map(point => ({ date: point.date, accuracy: point.accuracy, study_set_id: point.study_set_id || null, study_set: point.study_set })),
    best_study_hours: (summary.best_study_hours || []).map(hour => ({ hour: hour.hour, minutes: hour.minutes })),
    weak_topics: (summary.weak_topics || []).map(topic => ({
      topic: topic.topic, accuracy: topic.accuracy, last_seen: topic.last_seen, study_set_id: topic.study_set_id || null,
      url: topic.study_set_id ? studySetUrl(ctx, topic.study_set_id) : null,
    })),
    question_types_needing_work: (summary.question_types_needing_work || []).map(row => ({ type: row.type, accuracy: row.accuracy, answered: row.answered })),
    url: link(ctx, '/progress'),
  });
}

// 8. get_job_status ----------------------------------------------------------------------------
async function getJobStatus(ctx, { job_id }) {
  const { data: job, error } = await ctx.db.from('generation_jobs').select('id, status, progress, study_set_id, error, created_at, updated_at').eq('id', job_id).maybeSingle();
  if (error) return unavailable('job');
  if (!job) return notFound('job');
  return ok({
    job_id: job.id,
    status: job.status,
    progress: job.progress ?? null,
    study_set_id: job.study_set_id || null,
    url: job.study_set_id ? studySetUrl(ctx, job.study_set_id) : null,
    error: job.status === 'failed' ? clip(job.error || 'The study set could not be made.', 500) : null,
    updated_at: zonedIso(job.updated_at, ctx.timeZone),
  });
}

// Definitions ------------------------------------------------------------------------------------
const lectureMoment = z.number().int().nullable();

export const READ_TOOLS = [
  {
    name: 'search_my_materials',
    title: 'Search my study materials',
    description: 'Searches the student\'s own Cordia study sets, flashcards, notes and lecture recordings. Use this first for any question about their courses, so answers match what their professor taught, and cite the returned titles and lecture timestamps. Not for general knowledge.',
    input: {
      query: z.string().min(1).max(500).describe('What to look for, in the student\'s words.'),
      course_id: id.optional().describe('Only this course (a course id from another result).'),
      kinds: z.array(z.enum(KINDS)).max(4).optional().describe('Only these kinds of material.'),
      limit: z.number().int().min(1).max(20).default(8),
    },
    output: {
      query: z.string(),
      results: z.array(z.object({
        kind: z.enum(KINDS), id: z.string(), title: z.string(), course, snippet: z.string(),
        timestamp_seconds: lectureMoment.optional(), card_index: z.number().int().optional(), url: z.string(),
      })),
      truncated: z.boolean(),
    },
    run: searchMyMaterials,
  },
  {
    name: 'list_study_sets',
    title: 'List my study sets',
    description: 'Lists the student\'s study sets, newest first, optionally in one course or matching a title. Use it to find a study set\'s id; use search_my_materials to find what a set says.',
    input: {
      course_id: id.optional(),
      query: z.string().min(1).max(200).optional().describe('Words in the title.'),
      cursor: z.string().max(200).optional().describe('next_cursor from the previous page.'),
      limit: z.number().int().min(1).max(50).default(20),
    },
    output: {
      study_sets: z.array(z.object({
        id: z.string(), title: z.string(), course, created_at: z.string().nullable(), source_type: z.string(), card_count: z.number().int(),
        has_quiz: z.boolean(), has_practice: z.boolean(), status: z.enum(['ready', 'notes_only']), url: z.string(),
      })),
      next_cursor: z.string().nullable(),
    },
    run: listStudySets,
  },
  {
    name: 'get_study_set',
    title: 'Get a study set',
    description: 'Gets one study set\'s notes, outline and key terms, and on request its flashcards, quiz and practice problems. Use it after search or list returned the set\'s id; large sets come in pages (pass next_cursor).',
    input: {
      study_set_id: id,
      include: z.array(z.enum(SECTIONS)).max(6).optional().describe('Sections to return; default notes, outline and key_terms.'),
      cursor: z.string().max(200).optional(),
    },
    output: {
      id: z.string(), title: z.string(), course, created_at: z.string().nullable(), url: z.string(),
      sections: z.object({
        notes: z.array(z.object({ text: z.string() })).optional(),
        outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })).optional(),
        key_terms: z.array(z.object({ term: z.string(), context: z.string() })).optional(),
        flashcards: z.array(z.object({ card_id: z.string(), front: z.string(), back: z.string(), due_on: z.string() })).optional(),
        quiz: z.array(z.object({ question_id: z.string(), question: z.string(), options: z.array(z.string()), answer: z.string() })).optional(),
        practice: z.array(z.object({ problem_id: z.string(), prompt: z.string(), answer: z.string(), solved: z.boolean() })).optional(),
      }),
      truncated: z.boolean(),
      next_cursor: z.string().nullable(),
    },
    run: getStudySet,
  },
  {
    name: 'list_lectures',
    title: 'List my lectures',
    description: 'Lists the student\'s recorded lectures, newest first, optionally in one course. Use it to find a lecture\'s id for get_lecture.',
    input: {
      course_id: id.optional(),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    output: {
      lectures: z.array(z.object({
        id: z.string(), title: z.string(), course, recorded_at: z.string().nullable(), duration_seconds: z.number().int().nullable(), has_summary: z.boolean(), url: z.string(),
      })),
      next_cursor: z.string().nullable(),
    },
    run: listLectures,
  },
  {
    name: 'get_lecture',
    title: 'Get a lecture',
    description: 'Gets one recorded lecture: its outline, the "Watch for" points the professor stressed (with quotes and timestamps), to-dos mentioned, key terms, questions asked in class and the student\'s own notes. Ask for the transcript only when needed; it comes in pages.',
    input: {
      lecture_id: id,
      include_transcript: z.boolean().default(false),
      cursor: z.string().max(200).optional().describe('next_cursor from the previous transcript page.'),
    },
    output: {
      id: z.string(), title: z.string(), course, recorded_at: z.string().nullable(), duration_seconds: z.number().int().nullable(), url: z.string(),
      summary: z.array(z.string()),
      outline: z.string(),
      watch_for: z.array(z.object({ quote: z.string(), timestamp_seconds: lectureMoment, note: z.string() })),
      todos: z.array(z.object({ text: z.string(), kind: z.string(), due_date: z.string().nullable(), timestamp_seconds: lectureMoment })),
      key_terms: z.array(z.object({ term: z.string(), definition: z.string(), timestamp_seconds: lectureMoment })),
      practice_questions: z.array(z.object({ question: z.string(), timestamp_seconds: lectureMoment })),
      student_notes: z.string(),
      transcript: z.array(z.object({ timestamp_seconds: lectureMoment, text: z.string() })).nullable(),
      next_cursor: z.string().nullable(),
    },
    run: getLecture,
  },
  {
    name: 'get_due_cards',
    title: 'Get cards due for review',
    description: 'Gets what Cordia\'s Study now would review today, in the same order: questions the student missed while sure, then due flashcards, Learn ideas and other misses. Never show a card\'s back before the student has answered.',
    input: {
      study_set_id: id.optional(),
      course_id: id.optional(),
      limit: z.number().int().min(1).max(30).default(10),
    },
    output: {
      total_due: z.number().int(),
      today: z.string(),
      cards: z.array(z.object({
        card_id: z.string(), kind: z.enum(['flashcard', 'learn_idea', 'missed_question']),
        study_set: z.object({ id: z.string(), title: z.string(), course }),
        front: z.string(), back: z.string(), due_on: z.string(),
        last_confidence: z.enum(['sure', 'think', 'guess']).nullable(), times_wrong: z.number().int(), missed_while_sure: z.boolean(),
      })),
      url: z.string(),
    },
    run: getDueCards,
  },
  {
    name: 'get_progress',
    title: 'Get my study progress',
    description: 'Gets the student\'s streak, active study minutes, quiz accuracy over time, best study hours and weakest study sets, counted the way Cordia\'s Progress page counts them. Use weak_topics to choose what to review.',
    input: {
      course_id: id.optional(),
      range: z.enum(['7d', '30d', 'semester']).default('30d'),
    },
    output: {
      range: z.string(), since: z.string(), time_zone: z.string(), course,
      streak_days: z.number().int(), studied_today: z.boolean(), active_study_minutes: z.number(),
      quiz_accuracy_trend: z.array(z.object({ date: z.string(), accuracy: z.number(), study_set_id: z.string().nullable(), study_set: z.string() })),
      best_study_hours: z.array(z.object({ hour: z.number().int(), minutes: z.number() })),
      weak_topics: z.array(z.object({ topic: z.string(), accuracy: z.number(), last_seen: z.string(), study_set_id: z.string().nullable(), url: z.string().nullable() })),
      question_types_needing_work: z.array(z.object({ type: z.string(), accuracy: z.number(), answered: z.number().int() })),
      url: z.string(),
    },
    run: getProgress,
  },
  {
    name: 'get_job_status',
    title: 'Check a study set job',
    description: 'Checks a study set that Cordia is making in the background (from create_study_set): queued, running, done or failed. When done, it gives the new study set\'s id and link.',
    input: { job_id: id },
    output: {
      job_id: z.string(), status: z.enum(['queued', 'running', 'done', 'failed']), progress: z.number().nullable(),
      study_set_id: z.string().nullable(), url: z.string().nullable(), error: z.string().nullable(), updated_at: z.string().nullable(),
    },
    run: getJobStatus,
  },
];

export function registerReadTools(server, ctx) {
  for (const tool of READ_TOOLS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: z.object(tool.input).strict(),
      outputSchema: z.object(tool.output),
      annotations: { title: tool.title, ...READ_ONLY },
    }, async args => {
      try {
        await ctx.load();
        return await tool.run(ctx, args);
      } catch {
        return failure('Something went wrong in Cordia. Try again in a moment.');
      }
    });
  }
}
