// Study now's queue (the pure rules are in studyQueue.mjs, shared with the MCP server), loaded with
// what this browser has.
import { apiFetch } from './api';
import { retainMisses } from './userStore';
import { buildStudyQueue, openProblems } from './studyQueue.mjs';

export { buildStudyQueue, dueCards, dueCount, learnAfterReview, learnIdeas, openProblems } from './studyQueue.mjs';

// Everything Daily review runs: the round above, across every guide (or one guide, for its Study
// now), then open practice. Uses only existing read endpoints.
export async function loadStudyQueue({ practiceGuides = 5, guideId = '' } = {}) {
  const data = guideId ? await apiFetch('/guides/' + guideId).then(result => ({ guides: result?.guide ? [result.guide] : [] })) : await apiFetch('/guides?limit=100');
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const { items, cardTotal } = buildStudyQueue(guides, retainMisses(), { guideId });
  const recent = guides.slice(0, practiceGuides);
  const states = await Promise.all(recent.map(guide => apiFetch(`/practice/${guide.id}/state`)));
  const practice = recent
    .map((guide, index) => ({ guideId: guide.id, guideTitle: guide.title, open: openProblems(states[index]?.practice) }))
    .filter(item => item.open > 0);
  const problems = practice.reduce((sum, item) => sum + item.open, 0);
  const minutes = Math.max(1, Math.round(items.length * 0.3 + problems * 2));
  return {
    guides,
    items,
    cardTotal,
    practice,
    problems,
    minutes: items.length || problems ? minutes : 0,
  };
}
