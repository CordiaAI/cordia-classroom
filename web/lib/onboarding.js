import { apiFetch } from './api';

export async function loadOnboarding() {
  const data = await apiFetch('/onboarding');
  // Unreadable progress must never trap a student in the wizard.
  return data && typeof data.completed === 'boolean' ? data : { step: 'done', completed: true };
}

export function saveOnboardingStep(step) {
  return apiFetch('/onboarding', { method: 'PUT', body: JSON.stringify({ step }) });
}
