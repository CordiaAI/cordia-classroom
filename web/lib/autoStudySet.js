import { apiErrorMessage, apiFetch } from './api';
import { studySetRequestId, studySetSource } from './studySet.mjs';

// The study set being made for each guide, so the guide page and Learn (or Quiz, or Flashcards)
// opened right after it wait on one request instead of making two.
const running = new Map();

// Questions and cards from the guide's notes, saved to the guide. Resolves { guide } or { error }.
export function makeStudySet(guide) {
  if (running.has(guide.id)) return running.get(guide.id);
  const job = (async () => {
    const generated = await apiFetch('/generate', {
      method: 'POST',
      body: JSON.stringify({ content: studySetSource(guide.notes), notes: false, study_guide: true, flashcards: true, request_id: studySetRequestId(guide.id) }),
      timeoutMs: 6 * 60 * 1000,
    });
    if (!generated?.study_guide || generated.study_guide.startsWith('[Error')) {
      return { error: apiErrorMessage(generated?.detail, "The questions weren't made. Try again.") };
    }
    // Cards the student already made stay; the new ones follow them.
    const flashcards = [...(guide.flashcards || []), ...(generated.flashcards || [])];
    const data = await apiFetch('/guides/' + guide.id, { method: 'PATCH', body: JSON.stringify({ title: guide.title, study_guide: generated.study_guide, flashcards }) });
    return data?.guide ? { guide: data.guide } : { error: apiErrorMessage(data?.detail, "The questions weren't saved. Try again.") };
  })().finally(() => running.delete(guide.id));
  running.set(guide.id, job);
  return job;
}
