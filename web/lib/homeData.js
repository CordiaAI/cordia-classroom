import { apiFetch } from './api';
import { loadFolders } from './folders';
import { classLabel } from './classLabel';
import { readCalendarCache, rememberCalendar } from './calendarCache';
import { dueCount } from './studyQueue';
import { counts, dayKey, restoreLevels, testPlan } from './learnEngine.mjs';
import { learnQuestions, nearestExam } from './examCountdown.mjs';
import { deadlineTitle } from './formatters';

// Everything the chat home shows (DESIGN-SPEC 4.1), loaded together so the page appears once:
// the soonest exam with a review set and Learn's pace for it (the Dashboard's exam countdown,
// lib/examCountdown.mjs, and Learn's own math, lib/learnEngine.mjs), due flashcards (Study now's
// count, lib/studyQueue.mjs) and the next Canvas deadline (the Dashboard's Course work and feed).
const CALENDAR_WAIT_MS = 2500;
const safe = promise => promise.catch(() => null);

export async function loadHome(today = dayKey()) {
  // The Canvas feed is slow: this device's copy first; otherwise wait a little, then go without it
  // (it is saved for next time).
  const cached = readCalendarCache();
  const feedRequest = cached ? Promise.resolve(cached) : safe(apiFetch('/calendar/connection')).then(data => { rememberCalendar(data); return data; });
  const [guidesData, folderData, coursework, calendar] = await Promise.all([
    safe(apiFetch('/guides?fields=summary&limit=500')),
    safe(loadFolders()),
    safe(apiFetch('/calendar/coursework')),
    Promise.race([feedRequest, new Promise(resolve => setTimeout(() => resolve(null), CALENDAR_WAIT_MS))]),
  ]);
  const guides = Array.isArray(guidesData?.guides) ? guidesData.guides : [];
  const folders = Array.isArray(folderData?.folders) ? folderData.folders : [];
  const feed = calendar?.connected ? calendar.items || [] : [];
  const upcoming = Array.isArray(coursework?.upcoming) ? coursework.upcoming : [];
  const exams = [...upcoming, ...feed].filter(item => item?.type === 'exam');

  const exam = nearestExam(guides, exams, today);
  let plan = null;
  let className = '';
  if (exam) {
    const full = await safe(apiFetch('/guides/' + encodeURIComponent(exam.guideId)));
    if (full?.guide) {
      const questions = learnQuestions(full.guide);
      const tally = counts(questions, restoreLevels(questions, full.guide.flashcard_progress?.learn?.levels || {}), today);
      plan = testPlan(tally, exam.date, today);
    }
    const folderId = guides.find(guide => guide.id === exam.guideId)?.folder_id;
    const folder = folderId && folders.find(item => String(item.id) === String(folderId));
    if (folder) className = classLabel(folder.name).title || classLabel(folder.name).code || folder.name;
  }

  const due = guides.reduce((sum, guide) => sum + (Number(guide.flashcard_count) > 0 ? dueCount(guide) : 0), 0);
  const now = Date.now();
  const deadline = [...upcoming, ...feed]
    .filter(item => item && item.type !== 'exam' && !item.done && !item.internal && item.id && item.due_at && new Date(item.due_at).getTime() >= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0] || null;

  return {
    exam,
    plan,
    className,
    due,
    deadline: deadline ? { ...deadline, title: deadlineTitle(deadline) } : null,
    guideCount: guides.length,
  };
}
