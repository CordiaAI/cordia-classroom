// Plain helpers for guide visibility (social plan, Stage 3), kept free of React and the API so the
// Node tests can check them.

export const VISIBILITIES = ['public', 'link', 'classroom', 'private'];
export const VISIBILITY_LABELS = { public: 'Public', link: 'Link', classroom: 'Classroom', private: 'Private' };

// The chip's text: "Classroom · MGT 300" names the class; anything unknown reads as Private.
export function chipLabel(visibility, course) {
  const key = VISIBILITIES.includes(visibility) ? visibility : 'private';
  return key === 'classroom' && course?.code ? `Classroom · ${course.code}` : VISIBILITY_LABELS[key];
}

// One line of the outline preview as plain text: no heading marks or bullets.
export function outlineLine(line) {
  const text = String(line || '');
  return { heading: /^#{1,6}\s/.test(text), text: text.replace(/^#{1,6}\s+/, '').replace(/^[-*•]\s+/, '').trim() };
}

// The second line of a saved guide in Library > Saved.
export function savedMeta(item) {
  const who = item.author ? item.author.display_name || `@${item.author.username}` : 'Anonymous classmate';
  const count = Number(item.question_count) || 0;
  const updated = Number(item.version || 1) > Number(item.pinned_version || 1) ? 'Updated since you saved it' : '';
  return [who, `${count} ${count === 1 ? 'question' : 'questions'}`, updated].filter(Boolean).join(' · ');
}
