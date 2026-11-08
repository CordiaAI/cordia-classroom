// What someone can report a guide, a profile or a classroom for (social plan, Stage 9). The same
// lists as backend services/reports.py REASONS; the server refuses anything else.
export const REASON_LABELS = {
  wrong: 'Wrong or misleading',
  copied_exam: 'Copied from an exam',
  copyright: 'Copyright',
  inappropriate: 'Inappropriate',
  harassment: 'Harassment or impersonation',
};

export const REASONS = {
  guide: ['wrong', 'copied_exam', 'copyright', 'inappropriate', 'harassment'],
  profile: ['harassment', 'inappropriate'],
  classroom: ['inappropriate', 'harassment', 'copied_exam'],
};

export const TARGET_NAMES = { guide: 'guide', profile: 'profile', classroom: 'classroom' };

export function reasonsFor(targetType) {
  return (REASONS[targetType] || []).map(key => ({ key, label: REASON_LABELS[key] }));
}

// The server says "isn't available yet" before its database update; the page then offers Send
// feedback instead, as before.
export function reportUnavailable(detail) {
  return /isn.t available yet/i.test(String(detail || ''));
}
