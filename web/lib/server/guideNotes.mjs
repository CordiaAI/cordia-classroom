// Server-only: summary notes for a guide that has none (/api/guide-notes).
// Reads the guide with the student's own sign-in (so only their guides), writes notes that
// summarize every section of it, and saves them to the guide. Needs OPENAI_API_KEY.
// Guides made by /generate already get notes; this fills in guides from other paths.

export const NOTES_RULES = `You write study notes that summarize a student's study guide. Use only what the guide says.
Return JSON: {"notes": ["...", "..."]}
- Cover every section of the guide; keep its order.
- Each note is one complete, self-contained point in plain language (under 30 words): a definition, role, cause, step, comparison, example or other meaningful detail.
- Keep names, numbers, dates and formulas exactly as written.
- No questions, no headings, no filler such as "This section covers".
- Between 6 and 30 notes, depending on how much the guide contains.`;

export function notesText(list) {
  return list.map(note => `- ${String(note).replace(/\s+/g, ' ').trim()}`).filter(line => line.length > 3).join('\n');
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
    if (String(guide.notes || '').trim()) return { status: 200, body: { notes: guide.notes } };
    if (!openaiKey) return { status: 200, body: { notes: '', reason: 'not_configured' } };
    const content = String(guide.study_guide || '').trim();
    if (content.length < 40) return { status: 200, body: { notes: '', reason: 'empty' } };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    let list = [];
    try {
      const ai = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 2000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: NOTES_RULES }, { role: 'user', content: `Title: ${guide.title}\n\n${content.slice(0, 60000)}` }] }),
        signal: controller.signal,
      });
      if (ai.ok) list = JSON.parse((await ai.json())?.choices?.[0]?.message?.content || '{}').notes || [];
    } catch {
      list = [];
    } finally {
      clearTimeout(timer);
    }
    const notes = notesText(Array.isArray(list) ? list.slice(0, 30) : []);
    if (!notes) return { status: 200, body: { notes: '', reason: 'failed' } };
    await fetchImpl(`${apiBase}/guides/${guideId}`, {
      method: 'PATCH', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: guide.title, notes }),
    }).catch(() => null);
    return { status: 200, body: { notes } };
  }

  return { make };
}
