// Saving flashcard and Learn progress. Only the cards and ideas just answered are sent, and the
// database merges them into the guide under a row lock (merge_study_progress), so an answer saved
// meanwhile from a connected app (Claude) or another device is kept. Until that database function
// exists, the old routes save the whole progress instead.
import { apiFetch } from './api';
import { applyResults, scheduleChanges } from './spacedReview.mjs';
import { changedLevels } from './learnEngine.mjs';
import { supabaseRest } from './serverCopies';
import { saveViewerProgress } from './studyGuide';

async function merge(guideId, cards, learn) {
  try {
    const result = await supabaseRest()('/rest/v1/rpc/merge_study_progress', { method: 'POST', body: { guide: guideId, cards: cards || null, learn: learn || null } });
    return result.ok && result.data && typeof result.data === 'object' ? result.data : null;
  } catch {
    return null;
  }
}

// One round's flashcard results ({ known, missed } card indexes) and, optionally, Learn's levels
// after it ({ levels, test_date } from learnAfterReview). Returns the progress to show next.
// viewer: the `viewer` of someone else's guide (lib/studyGuide.js); saves go to your own progress.
export async function saveStudyResults(guideId, before, { known = [], missed = [] }, learn = null, viewer = null) {
  const next = known.length || missed.length ? applyResults(before, { known, missed }) : before || {};
  const cards = scheduleChanges(next, [...known, ...missed]);
  const learnChanges = learn ? { levels: changedLevels(before?.learn?.levels, learn.levels), test_date: learn.test_date ?? null } : null;
  if (!Object.keys(cards).length && !learnChanges) return next;
  if (viewer) {
    const saved = await saveViewerProgress(guideId, viewer, { cards: Object.keys(cards).length ? cards : null, learn: learnChanges });
    return saved || (learn ? { ...next, learn } : next);
  }
  const merged = await merge(guideId, Object.keys(cards).length ? cards : null, learnChanges);
  if (merged) return merged;
  // Before the merge function exists: the whole progress, as before (flashcards first, then Learn).
  if (Object.keys(cards).length) await apiFetch('/guides/' + guideId + '/flashcard-progress', { method: 'PATCH', body: JSON.stringify(next) });
  if (learn) await apiFetch('/guides/' + guideId + '/learn-progress', { method: 'PATCH', body: JSON.stringify(learn) });
  return learn ? { ...next, learn } : next;
}

// Learn's levels after a round or a test-date change: only the ideas that changed since `saved`.
// body.test_format (LEARN_LADDER_V2) rides along; the database merge keeps it once migration
// 20261111130000 runs, and Learn re-saves it on its own until then.
export async function saveLearnLevels(guideId, saved, body, viewer = null) {
  const learn = { levels: changedLevels(saved, body.levels), test_date: body.test_date ?? null, ...(body.test_format ? { test_format: body.test_format } : {}) };
  if (viewer) return saveViewerProgress(guideId, viewer, { learn });
  const merged = await merge(guideId, null, learn);
  if (merged) return merged;
  await apiFetch(`/guides/${guideId}/learn-progress`, { method: 'PATCH', body: JSON.stringify(body) });
  return null;
}
