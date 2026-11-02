// The daily study log (heatmap, recap, streak freezes) as stored on the server (study_days) and in
// the browser's copy ({ m: minutes, c: cards, r: right, t: total, g: { guideKey: { n, m, k } } }).
// Pure, so the app's sync and its tests share it.

export function rowToDay(row) {
  return {
    m: Number(row?.minutes) || 0,
    c: Number(row?.cards) || 0,
    r: Number(row?.right_count) || 0,
    t: Number(row?.total) || 0,
    g: row?.guides && typeof row.guides === 'object' && !Array.isArray(row.guides) ? row.guides : {},
  };
}

export function dayToRow(userId, day, entry) {
  return {
    user_id: userId,
    day,
    minutes: Math.min(1440, Math.max(0, Math.round((Number(entry?.m) || 0) * 10) / 10)),
    cards: Math.max(0, Math.round(Number(entry?.c) || 0)),
    right_count: Math.max(0, Math.round(Number(entry?.r) || 0)),
    total: Math.max(0, Math.round(Number(entry?.t) || 0)),
    guides: entry?.g && typeof entry.g === 'object' && !Array.isArray(entry.g) ? entry.g : {},
    updated_at: new Date().toISOString(),
  };
}

// The same day kept in two places (another device, or this browser before the server had it):
// the larger count wins for each number, and each guide keeps its longer time and every kind.
export function mergeDay(a = {}, b = {}) {
  const guides = {};
  for (const [key, entry] of [...Object.entries(a.g || {}), ...Object.entries(b.g || {})]) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !entry || typeof entry !== 'object') continue;
    const seen = guides[key];
    guides[key] = seen
      ? { n: seen.n || entry.n || '', m: Math.max(seen.m || 0, entry.m || 0), k: [...new Set([...(seen.k || []), ...(entry.k || [])])] }
      : { n: entry.n || '', m: entry.m || 0, k: [...(entry.k || [])] };
  }
  return {
    m: Math.max(a.m || 0, b.m || 0),
    c: Math.max(a.c || 0, b.c || 0),
    r: Math.max(a.r || 0, b.r || 0),
    t: Math.max(a.t || 0, b.t || 0),
    g: guides,
  };
}

// One study moment added to a day: minutes, cards, right/total answers, and the guide's minutes and
// kinds under its key (the guide id's first 8 characters, lib/progress.js groveKey). Pure: the app's
// recordStudy (lib/activity.js) and the MCP server's record_answer both use it.
export function addStudy(day, { guideId = '', guideTitle = '', minutes = 0, cards = 0, right = 0, total = 0, kind = '' } = {}) {
  const next = { m: Number(day?.m) || 0, c: Number(day?.c) || 0, r: Number(day?.r) || 0, t: Number(day?.t) || 0, g: { ...(day?.g || {}) } };
  next.m = Math.round((next.m + minutes) * 10) / 10;
  next.c += cards;
  next.r += right;
  next.t += total;
  const key = String(guideId || '').slice(0, 8);
  if (key && !['__proto__', 'constructor', 'prototype'].includes(key)) {
    const saved = Object.hasOwn(next.g, key) && next.g[key];
    const entry = saved ? { n: saved.n || '', m: Number(saved.m) || 0, k: [...(saved.k || [])] } : { n: guideTitle || '', m: 0, k: [] };
    entry.m = Math.round((entry.m + minutes) * 10) / 10;
    if (guideTitle) entry.n = guideTitle;
    if (kind && !entry.k.includes(kind)) entry.k.push(kind);
    next.g[key] = entry;
  }
  return next;
}
