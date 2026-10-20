// Server-only: a guide's Notes, an outline summary of the whole topic (/api/guide-notes).
// Reads the guide with the student's own sign-in (so only their guides), organises all of its
// information into topic headings with points, and saves that as the guide's notes.
// Runs once per guide: notes already in this form are kept. Needs OPENAI_API_KEY.

import { KEY_POINTS, isStudyGuideNotes } from '../formatters.js';

export const NOTES_RULES = `You write the notes of a study guide from a student's material: a short overview, the whole topic as a full outline, then the key points to remember. Use only what the material says.
Return JSON: {"overview": "...", "sections": [{"heading": "...", "points": [{"text": "...", "sub": ["..."]}]}], "key_points": ["..."]}
- overview: one or two sentences on what the topic is and how its parts fit together.
- sections: the full outline, grouped by topic in a logical teaching order (foundations first, then what builds on them), not in question order. 3 to 12 sections, each with a short heading (2 to 6 words).
- points: complete statements in plain language (under 30 words): definitions, roles, causes and effects, steps or stages, comparisons, examples, relationships and other meaningful detail. Put the supporting detail of a point (the items of a list, steps, examples, exceptions) in its "sub" list (under 20 words each).
- Put each key term in **double asterisks** where it is first defined.
- Cover all of the information in the material; keep names, numbers, dates and formulas exactly as written.
- key_points: 4 to 8 of the most important takeaways, one sentence each. They sum up the outline and add nothing new.
- No questions, no answers-to-questions phrasing, no filler such as "This section covers".`;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

// The text lib/formatters.js parseStudyNotes reads: "> overview", "## Heading", "- point",
// "  - detail", and "## Key points" at the end. Takes the AI's JSON (or a plain list of sections).
export function outlineText(notes) {
  const { overview = '', sections = [], key_points: keyPoints = [] } = Array.isArray(notes) ? { sections: notes } : (notes || {});
  const blocks = (sections || []).map(section => {
    const heading = clean(section?.heading);
    const points = (section?.points || []).map(point => (typeof point === 'string' ? { text: point, sub: [] } : point))
      .map(point => ({ text: clean(point?.text), sub: (point?.sub || []).map(clean).filter(Boolean).slice(0, 8) }))
      .filter(point => point.text);
    return heading && points.length ? [`## ${heading}`, ...points.flatMap(point => [`- ${point.text}`, ...point.sub.map(item => `  - ${item}`)])].join('\n') : '';
  }).filter(Boolean);
  if (!blocks.length) return '';
  // Always end with Key points (that marks notes as written); without any, each section's lead point.
  let key = (keyPoints || []).map(clean).filter(Boolean).slice(0, 10);
  if (!key.length) key = blocks.map(block => block.split('\n')[1].slice(2)).slice(0, 8);
  return [clean(overview) ? `> ${clean(overview)}` : '', ...blocks, [`## ${KEY_POINTS}`, ...key.map(point => `- ${point}`)].join('\n')]
    .filter(Boolean).join('\n\n');
}

// Notes written before the study-guide form (flat lists, outlines without key points) are rewritten.
export function needsOutline(notes) {
  return !isStudyGuideNotes(notes);
}

export function createGuideNotesService({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const openaiKey = env.OPENAI_API_KEY || '';
  const model = env.CLASSROOM_LECTURE_CHAT_MODEL || 'gpt-4o-mini';

  async function make(authorization, guideId) {
    if (!authorization || !/^[0-9a-f-]{36}$/i.test(guideId || '')) return { status: 400, body: { detail: 'Invalid guide.' } };
    const response = await fetchImpl(`${apiBase}/guides/${guideId}`, { headers: { Authorization: authorization } }).catch(() => null);
    if (!response?.ok) return { status: response?.status === 401 ? 401 : 404, body: { detail: 'Guide not found.' } };
    const guide = (await response.json())?.guide;
    if (!guide) return { status: 404, body: { detail: 'Guide not found.' } };
    if (!needsOutline(guide.notes)) return { status: 200, body: { notes: guide.notes } };
    if (!openaiKey) return { status: 200, body: { notes: guide.notes || '', reason: 'not_configured' } };
    const content = [String(guide.study_guide || '').trim(), String(guide.notes || '').trim()].filter(Boolean).join('\n\n');
    if (content.length < 40) return { status: 200, body: { notes: '', reason: 'empty' } };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    let written = null;
    try {
      const ai = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 4500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: NOTES_RULES }, { role: 'user', content: `Title: ${guide.title}\n\n${content.slice(0, 60000)}` }] }),
        signal: controller.signal,
      });
      if (ai.ok) written = JSON.parse((await ai.json())?.choices?.[0]?.message?.content || '{}');
    } catch {
      written = null;
    } finally {
      clearTimeout(timer);
    }
    const notes = outlineText(written && Array.isArray(written.sections) ? { ...written, sections: written.sections.slice(0, 12) } : null);
    if (!notes) return { status: 200, body: { notes: guide.notes || '', reason: 'failed' } };
    await fetchImpl(`${apiBase}/guides/${guideId}`, {
      method: 'PATCH', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: guide.title, notes }),
    }).catch(() => null);
    return { status: 200, body: { notes } };
  }

  return { make };
}
