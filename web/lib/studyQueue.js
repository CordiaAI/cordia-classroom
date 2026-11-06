// Study now's queue (the pure rules are in studyQueue.mjs, shared with the MCP server), loaded with
// what this browser has.
import { apiFetch } from './api';
import { retainMisses } from './userStore';
import { buildStudyQueue, openProblems } from './studyQueue.mjs';

export { buildStudyQueue, dueCards, dueCount, learnAfterReview, learnIdeas, openProblems } from './studyQueue.mjs';

// Where a round's guides come from: one guide (its Study now), a folder, a classroom (its guides, or
// the ones picked; someone else's guide comes with your own progress and a `viewer` to save with),
// or, by default, every guide (Daily review).
function loadGuides({ guideId, scope, id, guideIds }) {
  if (guideId) return apiFetch('/guides/' + guideId).then(result => ({ guides: result?.guide ? [result.guide] : [] }));
  if (scope === 'folder' && id) return apiFetch('/guides?limit=100&folder_id=' + encodeURIComponent(id));
  if (scope === 'classroom' && id) {
    const picked = guideIds.length ? '?guide_ids=' + guideIds.map(encodeURIComponent).join(',') : '';
    return apiFetch('/classrooms/' + encodeURIComponent(id) + '/study' + picked);
  }
  return apiFetch('/guides?limit=100');
}

// Everything Daily review runs: the round above, across every guide (or one guide, a folder or a
// classroom), then open practice. A folder or classroom round deals its guides in turn.
export async function loadStudyQueue({ practiceGuides = 5, guideId = '', scope = '', id = '', guideIds = [] } = {}) {
  const data = await loadGuides({ guideId, scope, id, guideIds });
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const interleave = !guideId && (scope === 'folder' || scope === 'classroom');
  const { items, cardTotal } = buildStudyQueue(guides, retainMisses(), { guideId, interleave });
  // Practice sets are the owner's own; someone else's guide has none to offer here.
  const recent = guides.filter(guide => !guide.viewer).slice(0, practiceGuides);
  const states = await Promise.all(recent.map(guide => apiFetch(`/practice/${guide.id}/state`)));
  const practice = recent
    .map((guide, index) => ({ guideId: guide.id, guideTitle: guide.title, open: openProblems(states[index]?.practice) }))
    .filter(item => item.open > 0);
  const problems = practice.reduce((sum, item) => sum + item.open, 0);
  const minutes = Math.max(1, Math.round(items.length * 0.3 + problems * 2));
  return {
    guides,
    classroom: data?.classroom || null,
    skipped: Number(data?.skipped) || 0,
    items,
    cardTotal,
    practice,
    problems,
    minutes: items.length || problems ? minutes : 0,
  };
}
