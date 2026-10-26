/**
 * Parse "Q1: ...\nA1: ..." text into [{index, question, answer}]
 */
export function parseQAPairs(text) {
  if (!text) return [];
  const pairs = [];
  const lines = text.split('\n');
  let currentQ = null;
  let lastPair = null;
  for (const line of lines) {
    const qMatch = line.match(/^Q(\d+):\s*(.+)/);
    const aMatch = line.match(/^A(\d+):\s*(.+)/);
    const imgMatch = line.match(/^\[IMG:(data:image\/.+)\]$/);
    if (qMatch) {
      currentQ = { index: parseInt(qMatch[1]), question: qMatch[2].trim() };
    } else if (aMatch && currentQ) {
      lastPair = { ...currentQ, answer: aMatch[2].trim(), image: null };
      pairs.push(lastPair);
      currentQ = null;
    } else if (imgMatch && lastPair) {
      lastPair.image = imgMatch[1];
    }
  }
  return pairs;
}

/**
 * Parse "- bullet\n- bullet" text into string[]
 */
// Notes as an outline: "## Heading" lines start a section, "- point" lines fill it. Older flat
// notes (points only) come back as one section without a heading.
export function parseOutline(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { current = { heading: line.slice(3).trim(), points: [] }; sections.push(current); }
    else if (line.startsWith('- ')) {
      if (!current) { current = { heading: '', points: [] }; sections.push(current); }
      current.points.push(line.slice(2).trim());
    }
  }
  return sections.filter(section => section.points.length);
}

// A guide's Notes, written like a study guide (lib/server/guideNotes.mjs writes it):
//   > overview
//   ## Topic heading
//   - point, with **key terms** in bold
//     - supporting detail under that point
//   ## Key points
//   - the takeaways, at the end
export const KEY_POINTS = 'Key points';

export function parseStudyNotes(text) {
  const notes = { overview: '', sections: [], keyPoints: [] };
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('> ')) notes.overview = [notes.overview, line.slice(2).trim()].filter(Boolean).join(' ');
    else if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      current = heading.toLowerCase() === KEY_POINTS.toLowerCase() ? 'key' : { heading, points: [] };
      if (current !== 'key') notes.sections.push(current);
    } else if (line.startsWith('- ')) {
      const point = line.slice(2).trim();
      if (current === 'key') { notes.keyPoints.push(point); continue; }
      if (!current) { current = { heading: '', points: [] }; notes.sections.push(current); }
      const last = current.points[current.points.length - 1];
      if (/^(\s{2,}|\t)- /.test(raw) && last) last.sub.push(point);
      else current.points.push({ text: point, sub: [] });
    }
  }
  notes.sections = notes.sections.filter(section => section.points.length);
  return notes;
}

export const hasStudyNotes = notes => notes.sections.length + notes.keyPoints.length > 0;

// Notes in the current study-guide form end with a Key points section; older notes get rewritten.
export const isStudyGuideNotes = text => /^##\s+key points\s*$/im.test(String(text || ''));

// What the guide's Notes tab shows: its notes, or, until AI has written them, the key points the
// guide's own answers make (so Notes is never empty).
export function guideNotes(guide) {
  const notes = parseStudyNotes(guide?.notes);
  if (hasStudyNotes(notes)) return notes;
  return { overview: '', sections: [], keyPoints: parseQAPairs(guide?.study_guide).map(pair => pair.answer).filter(Boolean) };
}

export function parseNotes(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.substring(2));
}

/**
 * Format ISO date string to readable format
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Canvas calendar feeds end every title with the section code ("Essay 2 [ENG-101-004]"). The class
// is shown on its own line, so the title drops it; the code is kept as the class when none is known.
const SECTION_CODE = /\s*\[([^\]]{2,80})\]\s*$/;
export function deadlineTitle(item) {
  return String(item?.title || '').replace(SECTION_CODE, '') || item?.title || '';
}
export function deadlineCourse(item) {
  return item?.course || String(item?.title || '').match(SECTION_CODE)?.[1] || '';
}

// Only https links and the app's own pages become hrefs; anything else (javascript:, data:, http:)
// falls back. The href is rebuilt behind a fixed scheme or "/", so no stored value can choose it.
export function safeHref(url, fallback) {
  const value = String(url || '');
  const web = /^https:\/\/(\S+)$/i.exec(value);
  if (web) return 'https://' + web[1];
  const page = /^\/(?!\/)(\S*)$/.exec(value);
  return page ? '/' + page[1] : fallback;
}
