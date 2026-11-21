// A guide that came in as notes only (a Canvas module, a Drive file, an exam review set) gets its
// questions and cards made from those notes the first time it is studied. The student's own notes
// pages wait for their button: they are still being written.

const MIN_SOURCE_CHARS = 40;
// Notes that are nothing but file names ("- Chapters 18 - 20-1.pptx"): the files get read first.
const FILE_NAME_LINE = /^[-*•\s]*\S.*\.(?:pptx?|pdf|docx?|txt)\s*$/i;

export function fileNamesOnly(notes) {
  const lines = String(notes || '').split('\n').filter(line => line.trim());
  return lines.length > 0 && lines.every(line => FILE_NAME_LINE.test(line));
}

// The first Notion import (live from about 01:47 UTC on 19 Nov 2026) wrote lines about the import
// itself into the notes it filed: "- Sub-page: <title>", "- Database: <title>" (or "## ..." for a short
// title) and, when it stopped early, a closing "- The rest of this Notion page wasn't imported ..."
// sentence. Only those exact lines, and only in a guide that import filed, stay out of the questions
// and cards; the same line in any other guide is the course's own text. Same rule as
// backend/services/text_processing.py is_f1_import_line (a test keeps the two in step).
const NOTION_SOURCE_PREFIX = 'notion:';
const F1_NOTION_LIVE = Date.parse('2026-11-19T01:45:00Z');
export const F1_IMPORT_NOTES = [
  "The rest of this Notion page wasn't imported because Notion was slow to answer.",
  "The rest of this Notion page wasn't imported because the page is longer than Cordia reads at once.",
  "Part of this Notion page couldn't be read, so it isn't all here.",
];
const F1_POINTER = /^(- |## )(?:Sub-page|Database): (\S.*)$/;

export function isF1ImportLine(line) {
  const text = String(line || '').replace(/[ \t\r]+$/, '');
  if (text.startsWith('- ') && F1_IMPORT_NOTES.includes(text.slice(2))) return true;
  const match = F1_POINTER.exec(text);
  if (!match) return false;
  const [, mark, title] = match;
  // A title that starts with a small letter or ends with a full stop reads as a definition: kept.
  if (/^\p{Ll}/u.test(title) || title.endsWith('.')) return false;
  if (mark === '## ') {
    const written = text.slice(3);
    return written.length >= 3 && written.length <= 80 && written.split(/\s+/).length <= 10 && !/[,;:?!]$/.test(written);
  }
  return true;
}

export function fromF1NotionImport(guide) {
  if (!String(guide?.external_source_id || '').startsWith(NOTION_SOURCE_PREFIX)) return false;
  const made = Date.parse(guide?.created_at || '');
  return !guide?.created_at || Number.isNaN(made) || made >= F1_NOTION_LIVE;
}

export function withoutImportLines(notes, guide) {
  const text = String(notes || '');
  return fromF1NotionImport(guide) ? text.split('\n').filter(line => !isF1ImportLine(line)).join('\n') : text;
}

// The notes as plain text to make the study set from (outline marks removed). `guide` is the row
// the notes came from (its external_source_id and created_at), for the import lines above.
export function studySetSource(notes, guide) {
  return withoutImportLines(notes, guide).replace(/^(>|##|\s*-)\s?/gm, '').trim();
}

export function isOwnNotes(guide) {
  const type = String(guide?.source_type || '');
  return type === 'notes' || type.startsWith('note:');
}

// Notes worth making questions from, and no questions yet.
export function needsStudySet(guide) {
  return Boolean(guide)
    && !String(guide.study_guide || '').trim()
    && !fileNamesOnly(guide.notes)
    && studySetSource(guide.notes, guide).length >= MIN_SOURCE_CHARS;
}

// Opening the guide makes them on its own only for material that came in from elsewhere.
export function makesStudySetOnOpen(guide) {
  return needsStudySet(guide) && !isOwnNotes(guide);
}

// One charge per guide, however often it is asked for (the backend never charges a key twice).
export function studySetRequestId(guideId) {
  return `study-set:${guideId}`;
}

// A new student's Canvas classes, the one with the soonest upcoming work first (course work names
// a class by its code or name), then classes already brought in, then by name.
export function firstGuideClasses(courses, upcoming) {
  const soonest = {};
  (upcoming || []).forEach(item => {
    const time = new Date(item?.due_at || '').getTime();
    if (item?.course && Number.isFinite(time) && !(soonest[item.course] <= time)) soonest[item.course] = time;
  });
  const due = course => Math.min(soonest[course.code] ?? Infinity, soonest[course.name] ?? Infinity);
  return [...(courses || [])].sort((a, b) => due(a) - due(b) || Number(Boolean(b.imported)) - Number(Boolean(a.imported))
    || String(a.code || a.name || '').localeCompare(String(b.code || b.name || '')));
}
