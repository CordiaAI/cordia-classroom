import { apiFetch } from './api';

export const TOUR_STEPS = ['smartnotes', 'practice'];

export async function loadOnboarding() {
  const data = await apiFetch('/onboarding');
  // Unreadable progress must never trap a student in the wizard.
  return data && typeof data.completed === 'boolean' ? data : { step: 'done', completed: true };
}

export function saveOnboardingStep(step) {
  return apiFetch('/onboarding', { method: 'PUT', body: JSON.stringify({ step }) });
}

// Open the student's latest SmartNote for the tour, creating a first note when they have none.
export async function smartNotesTourUrl() {
  const list = await apiFetch('/smart_notes');
  let id = list?.notes?.[0]?.id;
  if (!id) {
    const created = await apiFetch('/smart_notes', { method: 'POST', body: JSON.stringify({ title: 'My first notes' }) });
    id = created?.note?.id;
  }
  return id ? `/smartnotes?id=${encodeURIComponent(id)}&tour=1` : '/smartnotes';
}

// The Practice tour runs on the real workspace: the student's latest study guide, or the
// workspace with no guide chosen when they have none yet.
export async function practiceTourUrl() {
  const list = await apiFetch('/guides?fields=summary&limit=1');
  const id = list?.guides?.[0]?.id;
  return id ? `/practice/${encodeURIComponent(id)}?tour=1` : '/practice?tour=1';
}
