// Per-feature onboarding: a step for a feature that needs the student's input, shown once to students
// who finished onboarding before the feature existed. A new student's onboarding already covers it.
//
// To add one: append { id, added (YYYY-MM-DD, the day it ships), title } here and its body in
// components/FeatureOnboarding.js. Never reuse or rename an id. Finished ids are kept with What's
// new's seen lists (onboarding_progress.features via GET/PUT /onboarding/features, lib/whatsNew.js),
// so ids follow its format (lowercase letters, digits and hyphens) and start with "step-" so they
// never meet a release id.

export const FEATURE_STEPS = [
  { id: 'step-memory-style', added: '2026-11-05', title: 'How should Help me remember help you?' },
  { id: 'step-feedback-timing', added: '2026-11-06', title: 'When should quizzes show if you’re right?' },
];

// The steps to show, oldest first: only after the main onboarding is finished, only steps added
// after the day it was finished, and never one already finished (opened or dismissed) on any device.
// onboarding: GET /onboarding ({ completed, completed_at }); seen: What's new's { opened, dismissed }.
export function pendingSteps(onboarding, seen = {}, steps = FEATURE_STEPS) {
  if (!onboarding?.completed) return [];
  const finishedOn = onboarding.completed_at ? String(onboarding.completed_at).slice(0, 10) : '';
  const done = new Set([...(seen.opened || []), ...(seen.dismissed || [])]);
  return steps
    .filter(step => !done.has(step.id) && (!finishedOn || step.added > finishedOn))
    .sort((a, b) => a.added.localeCompare(b.added));
}
