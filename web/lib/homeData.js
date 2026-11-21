import { apiFetch } from './api';
import { loadFolders } from './folders';
import { readCalendarCache, rememberCalendar } from './calendarCache';
import { dueCount } from './studyQueue';
import { counts, dayKey, restoreLevels } from './learnEngine.mjs';
import { learnQuestions, nearestExam } from './examCountdown.mjs';
import { deadlineCourse, deadlineTitle } from './formatters';
import { HEADLINE_DAYS } from './homeText.mjs';
import { classDeadlines, weakIdea } from './homeHeadline.mjs';

// Everything the chat home shows (DESIGN-SPEC 4.1), loaded together so the page appears once:
// the soonest exam with a review set (the Dashboard's exam countdown, lib/examCountdown.mjs), due
// flashcards (Study now's count, lib/studyQueue.mjs) and the next Canvas deadline (the Dashboard's
// Course work and feed), and for each class what its headline can say (byClass, lib/homeHeadline.mjs):
// its exam within a week with Learn's tally for it (Learn's own math, lib/learnEngine.mjs), its next
// deadlines, and a weak idea from Learn. All of it from the same loads, so picking a class asks
// for nothing more.
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

  // What each class's headline reads. A class's exam is found among its own guides; its review set
  // is read in full only when the exam is within the headline's week.
  const items = [...upcoming, ...feed].filter(item => item && item.type !== 'exam' && !item.done && !item.internal && item.id && item.due_at)
    .map(item => ({ ...item, title: deadlineTitle(item), course: deadlineCourse(item) }));
  const entries = await Promise.all(folders.map(async folder => {
    const own = guides.filter(guide => String(guide.folder_id || '') === String(folder.id));
    const classExam = own.length ? nearestExam(own, exams, today) : null;
    const facts = { exam: classExam, weak: weakIdea(own, today), deadlines: classDeadlines(folder.name, items) };
    if (classExam && classExam.daysLeft <= HEADLINE_DAYS) {
      const full = await safe(apiFetch('/guides/' + encodeURIComponent(classExam.guideId)));
      if (full?.guide) {
        const questions = learnQuestions(full.guide);
        facts.tally = counts(questions, restoreLevels(questions, full.guide.flashcard_progress?.learn?.levels || {}), today);
      }
    }
    return [String(folder.id), facts];
  }));
  const byClass = Object.fromEntries(entries.filter(([, facts]) => facts.exam || facts.weak || facts.deadlines.length));

  const due = guides.reduce((sum, guide) => sum + (Number(guide.flashcard_count) > 0 ? dueCount(guide) : 0), 0);
  const now = Date.now();
  const deadline = [...upcoming, ...feed]
    .filter(item => item && item.type !== 'exam' && !item.done && !item.internal && item.id && item.due_at && new Date(item.due_at).getTime() >= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0] || null;

  return {
    exam,
    byClass,
    due,
    // The class travels with it (a feed item's is only in its title's section code) for the Plan suggestion.
    deadline: deadline ? { ...deadline, title: deadlineTitle(deadline), course: deadlineCourse(deadline) } : null,
    guideCount: guides.length,
  };
}
