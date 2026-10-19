// Lecture to-dos on Calendar and Today, merged with the Canvas feed (no browser APIs: tested in Node).

// Confirmed lecture to-dos as calendar items (they link to their lecture, inside Cordia).
export function lectureCalendarItems(todos) {
  return (todos || []).filter(todo => todo.due_at).map(todo => ({
    id: `lecture-${todo.id}`,
    title: todo.title,
    due_at: todo.due_at,
    type: todo.kind === 'exam' ? 'exam' : 'assignment',
    course: todo.lecture_title ? `From ${todo.lecture_title}` : 'From a lecture',
    url: `/lecture/${todo.lecture_id}`,
    internal: true,
  }));
}

const titleWords = title => new Set(String(title || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []);

// Canvas items plus lecture to-dos, without listing the same assignment twice (same day and
// mostly the same words in the title).
export function mergeCalendarItems(canvasItems = [], lectureItems = []) {
  const extra = lectureItems.filter(item => {
    const day = new Date(item.due_at).toDateString();
    const words = titleWords(item.title);
    return !canvasItems.some(other => {
      if (new Date(other.due_at).toDateString() !== day) return false;
      const otherWords = titleWords(other.title);
      const shared = [...words].filter(word => otherWords.has(word)).length;
      return shared / Math.max(1, Math.min(words.size, otherWords.size)) >= 0.6;
    });
  });
  return [...canvasItems, ...extra];
}
