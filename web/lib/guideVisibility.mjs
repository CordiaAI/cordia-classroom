// Plain helpers for guide visibility (social plan, Stage 3), kept free of React and the API so the
// Node tests can check them.

export const VISIBILITIES = ['public', 'link', 'classroom', 'private'];
export const VISIBILITY_LABELS = { public: 'Public', link: 'Link', classroom: 'Classroom', private: 'Private' };
const FRESH_MS = 10 * 60 * 1000;

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

// Whether a guide the student just opened should say something about sharing, once per student:
//   'notice' - it was made public by default: "New guides are public" with Make private;
//   'ask'    - it's private and new: offer the Honor Code sheet (only if they haven't accepted it);
//   null     - nothing.
export function firstPublishStep(guide, { now = Date.now(), asked = false } = {}) {
  if (!guide || asked) return null;
  const created = new Date(guide.created_at || 0).getTime();
  if (!(now - created < FRESH_MS)) return null;
  if (guide.linked_set_id || guide.forked_from_guide_id || guide.origin === 'mcp') return null;
  if (!String(guide.study_guide || '').trim()) return null;
  if (guide.visibility === 'public') return 'notice';
  if ((guide.visibility || 'private') === 'private') return 'ask';
  return null;
}

// The second line of a saved guide in Library > Saved.
export function savedMeta(item) {
  const who = item.author ? item.author.display_name || `@${item.author.username}` : 'Anonymous classmate';
  const count = Number(item.question_count) || 0;
  const updated = Number(item.version || 1) > Number(item.pinned_version || 1) ? 'Updated since you saved it' : '';
  return [who, `${count} ${count === 1 ? 'question' : 'questions'}`, updated].filter(Boolean).join(' · ');
}
