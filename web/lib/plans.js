// Display copy for CordiaClassroom plans. Limits themselves come from /billing/status,
// so the backend stays the only place a number is enforced.
export const PRO_NAME = 'CordiaClassroom Pro';

export const PRICES = {
  monthly: { label: 'Monthly', price: '$9.99', per: 'month', note: '' },
  semester: { label: 'Semester', price: '$29', per: '4 months', note: 'Save $10.96' },
};

export const FEATURE_COPY = {
  guide: { label: 'study guides', title: "You've used your free study guides", pro: 'Make a guide for every class, from the app or the extension' },
  tutor: { label: 'tutor prompts', title: "You've used your free tutor prompts", pro: 'Ask Cordia Tutor as much as you need' },
  learn_my_way: { label: 'Learn My Way views', title: "You've used your free Learn My Way views", pro: 'See every question explained the way you learn' },
  practice: { label: 'practice sets', title: 'Practice sets are a Pro feature', pro: 'Fresh practice problems from any guide' },
  ai_quiz: { label: 'AI Retain quizzes', title: 'AI Retain is a Pro feature', pro: 'Smarter Retain quizzes with tougher answer choices' },
  nclex: { label: 'NCLEX sets', title: 'NCLEX mode is a Pro feature', pro: 'NCLEX-style questions from your own material' },
  exam: { label: 'practice exams', title: 'Practice exams are a Pro feature', pro: 'Full practice exams from your guides' },
  retain_types: { label: 'Pro Retain sessions', title: 'Matching and fill in the blank are Pro', pro: 'Quiz yourself with matching and fill in the blank, not just multiple choice' },
  light: { label: 'AI reading actions', title: "You've reached this month's AI reading limit", pro: 'Read photos, scans and diagrams without limits' },
};

export const METERED = ['guide', 'tutor', 'learn_my_way'];

export const PRO_BENEFITS = [
  'Unlimited study guides from the app and the Chrome extension',
  'Unlimited Cordia Tutor',
  'Learn My Way on every question',
  'Practice sets, AI Retain, NCLEX and practice exams',
  'Guides that adapt to how you learn, every time you study',
];

export const FREE_SUMMARY = [
  '3 study guides a month (app + extension combined)',
  '10 tutor prompts a month',
  '5 Learn My Way views a month',
  'One free try of each Pro study tool',
];

export function resetLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
