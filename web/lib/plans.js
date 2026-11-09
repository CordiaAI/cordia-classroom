// Display copy for Cordia Classroom plans. Limits themselves come from /billing/status,
// so the backend (backend/services/entitlements.py) stays the only place a number is enforced.
export const PRO_NAME = 'Cordia Classroom';

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
  tutor: { label: 'tutor prompts', title: "You've used your tutor prompts for this month", pro: '300 Cordia Tutor replies a month with Pro, 1,000 with Academic Weapon' },
  learn_my_way: { label: 'Explain views', title: "You've used your free Explain views", pro: 'See every question explained the way you learn' },
  practice: { label: 'practice sets', title: "You've used this month's practice sets", pro: 'Fresh practice problems from any guide' },
  ai_quiz: { label: 'AI quizzes', title: 'AI quizzes are a paid feature', pro: 'Smarter quizzes with tougher answer choices' },
  nclex: { label: 'NCLEX sets', title: 'NCLEX mode is a paid feature', pro: 'NCLEX-style questions from your own material' },
  retain_types: { label: 'Pro quiz sessions', title: 'Matching and fill in the blank are paid features', pro: 'Quiz yourself with matching and fill in the blank, not just multiple choice' },
  lecture_minute: { label: 'recording minutes', title: "You've used this month's recording minutes", pro: 'Record more of your lectures every month' },
  visual: { label: 'visuals', title: "You've used this month's visuals", pro: 'Make up to 200 visuals a month with Academic Weapon' },
  light: { label: 'AI reading actions', title: "You've reached this month's AI reading limit", pro: 'Read up to 500 photos, scans and diagrams a month' },
};

export const METERED = ['guide', 'tutor', 'learn_my_way'];

// The Free plan's monthly allowances, the same numbers as LIMITS["free"] in entitlements.py
// (tests/test_billing_contract.py fails if they ever differ).
export const FREE_LIMITS = {
  guide: 3, tutor: 10, learn_my_way: 5, practice: 1, ai_quiz: 1, nclex: 1,
  retain_types: 1, light: 30, lecture_minute: 30, visual: 10,
};

// The free trial: TRIAL_DAYS and TRIAL_TIER in entitlements.py, started by /billing/start-trial
// (billing.py): no card, one per account, and it ends on its own, back on Free.
export const TRIAL = { tier: 'weapon', days: 7, cardRequired: false, perAccount: 1 };

export const FREE_SUMMARY = [
  `${FREE_LIMITS.guide} study guides a month (app + extension combined)`,
  `${FREE_LIMITS.tutor} tutor prompts a month`,
  `${FREE_LIMITS.learn_my_way} Explain views a month`,
  'One free try of each paid study tool',
];

export function resetLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
