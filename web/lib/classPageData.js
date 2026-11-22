import { apiErrorMessage, apiFetch } from './api';
import { loadFolders } from './folders';
import { listLectures } from './lectures';
import { canvasStatus } from './canvas';
import { readCalendarCache, rememberCalendar } from './calendarCache';
import { dayKey, readiness, testPlan } from './learnEngine.mjs';
import { guideTally } from './examCountdown.mjs';
import { classExam } from './classPage.mjs';
import { classChats } from './chats';
import { readShareDefault } from './classShare';

// Everything the class page in the new shell shows (components/ClassProject.js), loaded together so
// the page appears once: the class and its guides, notes and lectures; Learn's tally for each guide
// (lib/examCountdown.mjs guideTally, Learn's own counts); for a class with a course code, its
// Canvas course, deadlines, sharing and the class sets; the next exam with Learn's readiness and
// pace for its review set; the grade estimate; and the class's chats (lib/chats.js classChats, the
// saved chats Recent chats shows).
const CALENDAR_WAIT_MS = 2500; // the Canvas feed is slow: this device's copy first, else a short wait
const GRADES_WAIT_MS = 4000;
const MAX_TALLIES = 40; // Learn's tally needs each guide's questions; a very large class shows the first 40
const safe = promise => Promise.resolve(promise).catch(() => null);
const within = (promise, ms) => Promise.race([safe(promise), new Promise(resolve => setTimeout(() => resolve(null), ms))]);
const enc = encodeURIComponent;

async function eachLimited(list, size, run) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const at = next;
      next += 1;
      out[at] = await run(list[at]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker));
  return out;
}

function calendarFeed() {
  const cached = readCalendarCache();
  if (cached) return Promise.resolve(cached);
  return safe(apiFetch('/calendar/connection')).then(data => { rememberCalendar(data); return data; });
}

export async function loadClassPage(folderId, today = dayKey()) {
  const [foldersData, guidesData, notesData, lectureData] = await Promise.all([
    safe(loadFolders()), safe(apiFetch('/guides?fields=summary&folder_id=' + enc(folderId))), safe(apiFetch('/smart_notes')), safe(listLectures()),
  ]);
  const failure = [foldersData, guidesData].find(data => !data || data.detail);
  if (failure) return { error: apiErrorMessage(failure?.detail, 'This class could not be loaded.') };
  const folders = foldersData?.folders || [];
  const folder = folders.find(item => item.id === folderId);
  if (!folder) return { error: 'This class no longer exists or you do not have access to it.' };

  const guides = (guidesData?.guides || []).filter(guide => String(guide.folder_id || '') === String(folderId));
  const notes = (notesData?.notes || []).filter(note => note.folder_id === folderId);
  const lectures = (lectureData?.lectures || []).filter(lecture => lecture.folder_id === folderId);
  const classId = folder.class_id || '';

  const statusRequest = classId ? safe(canvasStatus()) : Promise.resolve(null);
  const courseOf = status => (status?.courses || []).find(item => item.imported && item.class_id === classId) || null;
  const [status, classResult, deadlineResult, sharing, shareDefault, coursework, calendar, fulls, chats, grades] = await Promise.all([
    statusRequest,
    classId ? safe(apiFetch('/classes/' + enc(classId))) : null,
    classId ? safe(apiFetch(`/classes/${enc(classId)}/deadlines`)) : null,
    classId ? safe(apiFetch('/sharing/settings')) : null,
    classId ? readShareDefault(classId) : null,
    guides.length || classId ? safe(apiFetch('/calendar/coursework')) : null,
    guides.length ? within(calendarFeed(), CALENDAR_WAIT_MS) : null,
    eachLimited(guides.slice(0, MAX_TALLIES), 6, guide => safe(apiFetch('/guides/' + enc(guide.id)))),
    safe(classChats(folderId)),
    statusRequest.then(status => (courseOf(status) ? within(apiFetch(`/canvas/courses/${enc(courseOf(status).id)}/grades`), GRADES_WAIT_MS) : null)),
  ]);

  const full = {};
  const tallies = {};
  (fulls || []).forEach(data => {
    if (!data?.guide?.id) return;
    full[data.guide.id] = data.guide;
    tallies[data.guide.id] = guideTally(data.guide, today);
  });

  // Exams for the card: Canvas course work and the calendar feed, the same lists the Dashboard,
  // the home and the sidebar read. Course work also says what kind each deadline is.
  const work = [...(coursework?.upcoming || []), ...(coursework?.missing || [])];
  const feed = calendar?.connected ? calendar.items || [] : [];
  const exams = [...work, ...feed].filter(item => item?.type === 'exam');
  const kinds = Object.fromEntries([...work, ...feed].filter(item => item?.id).map(item => [String(item.id), item.type]));
  const cls = classResult?.class || null;
  const deadlines = classId ? (deadlineResult?.deadlines || []).map(item => ({ ...item, type: kinds[String(item.id)] || 'assignment', course: cls?.code || '' })) : null;

  let exam = classExam(guides, exams, (deadlines || []).map(item => item.id), today);
  if (exam?.guideId) {
    const guide = full[exam.guideId] || (await safe(apiFetch('/guides/' + enc(exam.guideId))))?.guide;
    if (guide) {
      const tally = tallies[exam.guideId] || guideTally(guide, today);
      tallies[exam.guideId] = tally;
      exam = { ...exam, percent: readiness(tally), plan: testPlan(tally, exam.date, today) };
    } else exam = { ...exam, guideId: '' };
  }

  return {
    folder,
    folders,
    guides,
    notes,
    lectures,
    tallies,
    cls,
    classData: cls ? classResult : null,
    deadlines,
    showName: typeof sharing?.show_first_name === 'boolean' ? sharing.show_first_name : null,
    shareDefault,
    course: courseOf(status),
    lastSynced: status?.last_synced_at || '',
    grades: grades && Array.isArray(grades.upcoming) ? grades : null,
    exam,
    chats: Array.isArray(chats?.chats) ? chats.chats : [],
    chatsEditable: Boolean(chats?.editable),
  };
}
