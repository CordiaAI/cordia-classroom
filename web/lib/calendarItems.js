// Canvas calendar items: clean titles, class-code chips and friendly due labels.

const SECTION_WORDS = new Set(['SEC', 'SECTION', 'LEC', 'LAB', 'FA', 'SP', 'SU', 'WI', 'FALL', 'SPRING', 'SUMMER', 'WINTER']);

// "EH-102-136" -> "EH 102", "CIS-250-801" -> "CIS 250". '' when there's no course code.
export function courseCode(raw) {
  const text = String(raw || '').toUpperCase();
  const pattern = /(?<![A-Z])([A-Z]{1,6})[\s_\-.]*(\d{2,4}[A-Z]?)(?!\d)/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (!SECTION_WORDS.has(match[1])) return `${match[1]} ${match[2]}`;
  }
  return '';
}

// "Essay 1 [EH-102-136]" -> { title: "Essay 1", code: "EH 102" }
export function splitTitle(item) {
  const raw = String(item?.title || '');
  const bracket = raw.match(/\s*\[([^\]]{2,80})\]\s*$/);
  const title = (bracket ? raw.slice(0, bracket.index) : raw).trim() || raw.trim();
  const code = courseCode(bracket?.[1] || item?.course || '');
  return { title, code };
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function dueLabel(item, now = new Date()) {
  const due = new Date(item.due_at);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  const time = item.all_day ? '' : due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : days > 1 && days < 7 ? due.toLocaleDateString([], { weekday: 'long' })
      : due.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${day}, ${time}` : day;
}

// The Library folder for a class code, matched on the folder's own code.
export function folderForCode(folders, code) {
  if (!code) return null;
  return (folders || []).find(folder => courseCode(folder.name) === code) || null;
}
