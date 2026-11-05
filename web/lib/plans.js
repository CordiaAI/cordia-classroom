// Display copy for CordiaClassroom plans. Limits themselves come from /billing/status,
// so the backend (backend/services/entitlements.py) stays the only place a number is enforced.
export const PRO_NAME = 'CordiaClassroom';

// Paid tiers, cheapest first. `status.tier` from /billing/status is one of 'free' | 'pro' | 'weapon'.
export const TIERS = {
  pro: {
    name: 'Pro',
    price: '$4.99',
    per: 'month',
    pitch: 'The study loop: make, study, practice.',
    benefits: [
      '15 study guides a month (app + extension)',
      '300 Cordia Tutor replies a month',
      'Explain, quizzes, Retain, flashcards and NCLEX',
      '15 practice sets a month',
      '150 minutes of lecture recording a month',
    ],
  },
  weapon: {
    name: 'Academic Weapon',
    price: '$9.99',
    per: 'month',
    pitch: 'Everything in Pro, plus Cordia runs your semester for you.',
    benefits: [
      'Everything in Pro',
      '100 study guides a month',
      '1,000 Cordia Tutor replies a month',
      '75 practice sets a month',
      'Record every class: 20 hours a month',
      '200 visuals a month for guides, notes and the Tutor',
    ],
  },
};
export const TIER_ORDER = ['free', 'pro', 'weapon'];
export const isPaid = status => Boolean(status?.tier && status.tier !== 'free');
export const tierName = tier => (tier === 'free' || !tier ? 'Free' : TIERS[tier]?.name || 'Pro');

export const FEATURE_COPY = {
  guide: { label: 'study guides', title: "You've used your study guides for this month", pro: 'Make a guide for every class, from the app or the extension' },
  tutor: { label: 'tutor prompts', title: "You've used your tutor prompts for this month", pro: 'Ask Cordia Tutor as much as you need' },
  learn_my_way: { label: 'Explain views', title: "You've used your free Explain views", pro: 'See every question explained the way you learn' },
  practice: { label: 'practice sets', title: "You've used this month's practice sets", pro: 'Fresh practice problems from any guide' },
  ai_quiz: { label: 'AI quizzes', title: 'AI quizzes are a paid feature', pro: 'Smarter quizzes with tougher answer choices' },
  nclex: { label: 'NCLEX sets', title: 'NCLEX mode is a paid feature', pro: 'NCLEX-style questions from your own material' },
  retain_types: { label: 'Pro quiz sessions', title: 'Matching and fill in the blank are paid features', pro: 'Quiz yourself with matching and fill in the blank, not just multiple choice' },
  lecture_minute: { label: 'recording minutes', title: "You've used this month's recording minutes", pro: 'Record more of your lectures every month' },
  visual: { label: 'visuals', title: "You've used this month's visuals", pro: 'Make up to 200 visuals a month with Academic Weapon' },
  light: { label: 'AI reading actions', title: "You've reached this month's AI reading limit", pro: 'Read photos, scans and diagrams without limits' },
};

export const METERED = ['guide', 'tutor', 'learn_my_way'];

export const FREE_SUMMARY = [
  '3 study guides a month (app + extension combined)',
  '10 tutor prompts a month',
  '5 Explain views a month',
  'One free try of each paid study tool',
];

export function resetLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
