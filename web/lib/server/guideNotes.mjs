// Server-only: a guide's Notes, an outline summary of the whole topic (/api/guide-notes).
// Reads the guide with the student's own sign-in (so only their guides), organises all of its
// information into topic headings with points, and saves that as the guide's notes.
// Runs once per guide: notes already in outline form are kept. Needs OPENAI_API_KEY.

export const NOTES_RULES = `You turn a student's study material into organised notes: an outline summary of the topic. Use only what the material says.
Return JSON: {"sections": [{"heading": "...", "points": ["...", "..."]}]}
- Group the information by topic, in a logical teaching order (foundations first, then what builds on them), not in question order.
- Headings: short topic names (2 to 6 words). Use 3 to 10 sections.
- Points: complete, self-contained statements in plain language (under 30 words each): definitions, roles, causes and effects, steps, comparisons, examples, relationships and other meaningful detail.
- Cover all of the information in the material; keep names, numbers, dates and formulas exactly as written.
- No questions, no answers-to-questions phrasing, no filler such as "This section covers".`;

export const OUTLINE_MARK = /^##\s/m;

// "## Heading" lines with "- point" lines under them (the format lib/formatters.js parseOutline reads).
export function outlineText(sections) {
  return (sections || [])
    .map(section => {
      const heading = String(section?.heading || '').replace(/\s+/g, ' ').trim();
      const points = (section?.points || []).map(point => String(point).replace(/\s+/g, ' ').trim()).filter(Boolean);
      return heading && points.length ? [`## ${heading}`, ...points.map(point => `- ${point}`)].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// Older guides kept a flat list of notes; those are rewritten as an outline.
export function needsOutline(notes) {
  return !OUTLINE_MARK.test(String(notes || ''));
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
    let list = [];
    try {
      const ai = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: NOTES_RULES }, { role: 'user', content: `Title: ${guide.title}\n\n${content.slice(0, 60000)}` }] }),
        signal: controller.signal,
      });
      if (ai.ok) list = JSON.parse((await ai.json())?.choices?.[0]?.message?.content || '{}').sections || [];
    } catch {
      list = [];
    } finally {
      clearTimeout(timer);
    }
    const notes = outlineText(Array.isArray(list) ? list.slice(0, 12) : []);
    if (!notes) return { status: 200, body: { notes: guide.notes || '', reason: 'failed' } };
    await fetchImpl(`${apiBase}/guides/${guideId}`, {
      method: 'PATCH', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: guide.title, notes }),
    }).catch(() => null);
    return { status: 200, body: { notes } };
  }

  return { make };
}
