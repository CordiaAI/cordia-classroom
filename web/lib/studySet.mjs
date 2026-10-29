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

// The notes as plain text to make the study set from (outline marks removed).
export function studySetSource(notes) {
  return String(notes || '').replace(/^(>|##|\s*-)\s?/gm, '').trim();
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
    && studySetSource(guide.notes).length >= MIN_SOURCE_CHARS;
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
