// The home headline by class picker (FEEDBACK-BATCH-1 H1): the greeting for All classes, and for a
// picked class the exam, the deadline, the weak idea or a plain line, in that order; the same line
// for a student, class and day; the motion and the words' rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEADLINE_DAYS, WEAK_DAYS, classDeadlines, classWords, courseCode, dayDiff, dayPart, firstName, greeting, headlineSeed, homeHeadlineFor,
  assignmentName, nextHeadlineChange, sameClass, seedOf, shortenName, topicName, weakFromGuide, weakIdea,
} from '../lib/homeHeadline.mjs';
import { planTitle } from '../lib/homeText.mjs';
import { examReadiness } from '../lib/examCountdown.mjs';
import { fingerprint } from '../lib/learnEngine.mjs';

// A course code is kept on one line: "BIO 101" has a no-break space.
const nb = text => text.replace(/\b([A-Z]{2,5}) (\d{3,4}[A-Z]?)\b/g, '$1\u00a0$2');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Wednesday, November 18, 2026, 9:30 AM, local time.
const NOW = new Date(2026, 10, 18, 9, 30);
const at = (day, hour = 23, minute = 59) => new Date(2026, 10, day, hour, minute);
const clock = date => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const BIO = { id: 'f-bio', name: 'Introduction to Biology', code: 'BIO 101', tone: 2 };
const BUS = { id: 'f-bus', name: 'Business Ethics', code: 'BUS 210', tone: 3 };
// A seed per slot of the greeting (seed % 4).
const seedFor = slot => { for (let n = 0; ; n += 1) if (seedOf('s' + n) % 4 === slot) return seedOf('s' + n); };
const SAMPLE = Array.from({ length: 400 }, (_, index) => `student-${index}`);

test('All classes greets by first name, by the hour: 5 AM, noon, 5 PM and 11 PM start a new window', () => {
  const pick = hour => greeting({ name: 'Jane', hour, seed: seedFor(0) });
  assert.deepEqual([5, 11].map(pick), ['Good morning, Jane', 'Good morning, Jane']);
  assert.deepEqual([12, 16].map(pick), ['Good afternoon, Jane', 'Good afternoon, Jane']);
  assert.deepEqual([17, 22].map(pick), ['Good evening, Jane', 'Good evening, Jane']);
  assert.deepEqual([23, 0, 4].map(pick), ['Up late, Jane?', 'Up late, Jane?', 'Up late, Jane?']);
  assert.deepEqual([4, 5, 11, 12, 16, 17, 22, 23].map(dayPart), ['late', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'late']);
  assert.equal(greeting({ name: 'Jane', hour: 9, seed: seedFor(1) }), 'Good morning, Jane');
  assert.equal(greeting({ name: 'Jane', hour: 9, seed: seedFor(2) }), "What's on your mind, Jane?");
  assert.equal(greeting({ name: 'Jane', hour: 9, seed: seedFor(3) }), 'Ready when you are, Jane');
});

test('with no name there is no name, no comma and no stray space', () => {
  assert.deepEqual([0, 1, 2, 3].map(slot => greeting({ hour: 9, seed: seedFor(slot) })), ['Good morning', 'Good morning', "What's on your mind?", 'Ready when you are']);
  assert.equal(greeting({ hour: 2, seed: seedFor(0) }), 'Up late?');
  for (const seed of [0, 1, 2, 3, 77]) for (const hour of [3, 9, 14, 20]) assert.doesNotMatch(greeting({ hour, seed }), /,|\s{2}|\s$|undefined/);
  assert.equal(homeHeadlineFor({ now: NOW, name: '', studentKey: 'u1' }).title.includes(','), false);
  assert.equal(firstName(''), '');
  assert.equal(firstName(null), '');
});

test('the first name comes from the profile name: a title and a surname go; an email, phone or initial is no name', () => {
  assert.equal(firstName('Jane Q. Smith'), 'Jane');
  assert.equal(firstName('  Maria-Elena   Ortiz '), 'Maria-Elena');
  assert.equal(firstName('Dr. Amara Okafor'), 'Amara');
  assert.equal(firstName('jordan'), 'Jordan');
  assert.equal(firstName('Zoë Lindqvist'), 'Zoë');
  assert.equal(firstName('Test Student'), '', 'a placeholder, not a name');
  assert.equal(firstName('test.student@example.com'), '');
  assert.equal(firstName('+1 (555) 010-2030'), '');
  assert.equal(firstName('J'), '');
  assert.equal(firstName('Smith, Jane'), '');
  assert.equal(firstName('A'.repeat(40)), '');
});

test('time-of-day lines are twice as likely as each of the other two', () => {
  const counts = {};
  SAMPLE.forEach(key => { const line = greeting({ hour: 9, seed: headlineSeed(key, '', '2026-11-18') }); counts[line] = (counts[line] || 0) + 1; });
  assert.deepEqual(Object.keys(counts).sort(), ['Good morning', 'Ready when you are', "What's on your mind?"]);
  const morning = counts['Good morning'];
  assert.ok(morning > 160 && morning < 240, `morning ${morning} of ${SAMPLE.length}`);
  assert.ok(counts['Ready when you are'] > 70 && counts['Ready when you are'] < 130, `ready ${counts['Ready when you are']}`);
  assert.ok(counts["What's on your mind?"] > 70 && counts["What's on your mind?"] < 130, `mind ${counts["What's on your mind?"]}`);
});

test('a picked class with an exam in a week or less and a review set keeps the exam headline and pace line', () => {
  const info = { exam: { title: 'Exam 3', date: '2026-11-20', guideId: 'g1' }, tally: { total: 40, new: 10, learning: 10, familiar: 0, mastered: 10, fading: 0 } };
  assert.deepEqual(homeHeadlineFor({ pick: BIO, info, now: NOW }), { title: 'Friday is your Introduction to Biology exam.', line: '30 ideas left to master. 15 today keeps you on pace.', kind: 'exam' });
  assert.equal(homeHeadlineFor({ pick: BIO, info: { ...info, exam: { ...info.exam, date: '2026-11-19' } }, now: NOW }).title, 'Tomorrow is your Introduction to Biology exam.');
  assert.equal(homeHeadlineFor({ pick: BIO, info: { ...info, exam: { ...info.exam, date: '2026-11-18' } }, now: NOW }).title, 'Today is your Introduction to Biology exam.');
  assert.equal(homeHeadlineFor({ pick: BIO, info: { ...info, exam: { ...info.exam, date: '2026-11-25' } }, now: NOW }).title, 'Wednesday is your Introduction to Biology exam.', 'seven days out still counts');
  assert.equal(homeHeadlineFor({ pick: BIO, info: { ...info, tally: undefined }, now: NOW }).line, '', 'no tally, no pace line');
  // The exam wins over a deadline and a weak idea.
  const busy = { ...info, deadlines: [{ title: 'Lab report', due_at: at(19).toISOString() }], weak: { title: 'Cell membranes', percent: 40, at: '2026-11-17' } };
  assert.equal(homeHeadlineFor({ pick: BIO, info: busy, now: NOW }).kind, 'exam');
});

test('an exam more than a week out, or already past, is not the headline', () => {
  const far = { exam: { title: 'Midterm', date: '2026-11-26' } };
  assert.notEqual(homeHeadlineFor({ pick: BIO, info: far, now: NOW }).kind, 'exam');
  const past = { exam: { title: 'Midterm', date: '2026-11-17' } };
  assert.notEqual(homeHeadlineFor({ pick: BIO, info: past, now: NOW }).kind, 'exam');
});

test('a deadline within three days: "<Assignment> for <course code> is due <weekday>." and "Due <weekday> at <time>"', () => {
  const due = at(20);
  const result = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Packback Discussion', course: 'BUS-210-004', due_at: due.toISOString() }] }, now: NOW });
  assert.deepEqual(result, { title: nb('Packback Discussion for BUS 210 is due Friday.'), line: `Due Friday at ${clock(due)}`, kind: 'deadline' });
  const tomorrow = at(19, 17, 0);
  const next = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Career Portfolio', due_at: tomorrow.toISOString() }] }, now: NOW });
  assert.deepEqual([next.title, next.line], [nb('Career Portfolio for BUS 210 is due tomorrow.'), `Due tomorrow at ${clock(tomorrow)}`]);
  const later = at(18, 20, 0);
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Quiz 4', due_at: later.toISOString() }] }, now: NOW }).title, nb('Quiz 4 for BUS 210 is due today.'));
  // An all-day item has no time to give.
  const allDay = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Reading response', due_at: at(21, 0, 0).toISOString(), all_day: true }] }, now: NOW });
  assert.deepEqual([allDay.title, allDay.line], [nb('Reading response for BUS 210 is due Saturday.'), 'Due Saturday']);
  assert.equal(DEADLINE_DAYS, 3);
});

test('the soonest deadline inside the window is the one named; one that has passed or is four days out is not', () => {
  const info = { deadlines: [
    { title: 'Late one', due_at: at(21).toISOString() },
    { title: 'Already due', due_at: at(18, 8, 0).toISOString() },
    { title: 'Soon one', due_at: at(19).toISOString() },
  ] };
  assert.equal(homeHeadlineFor({ pick: BUS, info, now: NOW }).title, nb('Soon one for BUS 210 is due tomorrow.'));
  const none = { deadlines: [{ title: 'Already due', due_at: at(18, 8, 0).toISOString() }, { title: 'Far off', due_at: at(22).toISOString() }] };
  assert.notEqual(homeHeadlineFor({ pick: BUS, info: none, now: NOW }).kind, 'deadline');
});

test('assignment names are cut near 40 characters, at a word, and read as plain words', () => {
  const long = 'Annotated Bibliography for the Harlem Renaissance Research Paper';
  const cut = shortenName(long);
  assert.ok(cut.length <= 40 && cut.endsWith('…'), cut);
  assert.equal(cut, 'Annotated Bibliography for the Harlem…');
  assert.equal(shortenName('Quiz 4'), 'Quiz 4');
  assert.equal(shortenName('x'.repeat(60)).length, 40, 'a name with no spaces is cut at the limit');
  const result = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'A05 ' + long + ' [BUS-210-004]', due_at: at(20).toISOString() }] }, now: NOW });
  assert.equal(result.title, nb('Annotated Bibliography for the Harlem… for BUS 210 is due Friday.'));
  // A long name with a colon keeps the part that stands alone, in plain words; a short one keeps all of it.
  assert.equal(assignmentName('A05 Packback Discussion: Seven Ethical Frameworks and the Case for Stakeholder Theory [BUS-210-004]'), 'Packback Discussion', 'the title keeps its own case');
  assert.equal(assignmentName('Quiz 4: Chapters 5 to 7'), 'Quiz 4: Chapters 5 to 7');
  assert.equal(assignmentName(long), 'Annotated Bibliography for the Harlem…');
  assert.ok(assignmentName('Reflection: ' + 'x'.repeat(50)).length <= 40);
  // Only an id left: the sentence still reads.
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'NUR-210-01 [A05]', due_at: at(20).toISOString() }] }, now: NOW }).title, nb('Your next assignment for BUS 210 is due Friday.'));
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'quiz 4', due_at: at(20).toISOString() }] }, now: NOW }).title, nb('Quiz 4 for BUS 210 is due Friday.'));
});

// A guide whose Learn questions are `quizN` real questions; levels are { index: level } with a saved fingerprint.
const quizOf = count => Array.from({ length: count }, (_, index) => ({ question: `What is idea number ${index} in the reading`, options: [`answer ${index}`, 'b', 'c', 'd'], correct_index: 0 }));
function guideWith({ quiz, cards, levelsAt, stale = 0, title = 'Cardiac Pharmacology: review', day = '2026-11-17' }) {
  const questions = quizOf(quiz);
  const levels = {};
  levelsAt.forEach((level, index) => { levels[index] = { l: level, at: day, q: fingerprint(questions[index]) }; });
  for (let n = 0; n < stale; n += 1) levels[100 + n] = { l: 3, at: day, q: 'a question since edited out ' + n };
  return { id: 'g-cardiac', title, folder_id: 'f-nur', flashcard_count: cards, quiz_questions: questions, flashcard_progress: { learn: { levels } } };
}

test('a weak idea from Learn: the guide\'s topic name, never a raw question', () => {
  const levels = {
    0: { l: 1, at: '2026-11-17', q: 'what is the role of the cell membrane' },
    1: { l: 3, at: '2026-11-16', q: 'what organelle makes atp' },
    2: { l: 2, at: '2026-11-12', q: 'what is osmosis' },
    3: { l: 1, at: '2026-11-16', q: 'what does the nucleus store' },
  };
  const guide = { id: 'g-cells', title: 'Cell Structure and Transport: review', folder_id: 'f-bio', flashcard_count: 10, flashcard_progress: { learn: { levels } } };
  const found = weakIdea([guide], '2026-11-18');
  assert.deepEqual(found, { guideId: 'g-cells', title: 'Cell Structure and Transport', at: '2026-11-17' }, 'the list summary names the guide; its readiness is read from the guide itself');
  const result = homeHeadlineFor({ pick: BIO, info: { weak: { ...found, percent: 18 } }, now: NOW });
  assert.deepEqual(result, { title: 'Want another look at Cell Structure and Transport?', line: nb('18% ready in BIO 101'), kind: 'weak' });
  assert.ok(!Object.values(levels).some(entry => result.title.includes(entry.q)), 'no raw question');
  // No readiness (the guide could not be read): the headline stands without a number.
  assert.deepEqual(homeHeadlineFor({ pick: BIO, info: { weak: found }, now: NOW }), { title: 'Want another look at Cell Structure and Transport?', line: '', kind: 'weak' });
});

test('the weak idea\'s "% ready" is Learn\'s own number: only ideas that are current questions count', () => {
  const today = '2026-11-18';
  // The reviewer's four cases: the same counts, fewer questions than cards, more questions than cards, and
  // saved levels for questions since edited out. The home must say what Learn says.
  const cases = [
    guideWith({ quiz: 20, cards: 20, levelsAt: [1, 1, 3, 3, 3, 3, 2, 2] }),
    guideWith({ quiz: 12, cards: 20, levelsAt: [1, 1, 3, 3, 3, 3, 2, 2] }),
    guideWith({ quiz: 20, cards: 12, levelsAt: [1, 1, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3, 3] }),
    guideWith({ quiz: 20, cards: 20, levelsAt: [1, 1, 2, 2], stale: 6 }),
  ];
  for (const guide of cases) {
    const learn = examReadiness(guide.quiz_questions, guide.flashcard_progress.learn, today);
    assert.equal(weakFromGuide(guide, today).percent, learn, `${guide.quiz_questions.length} questions, ${guide.flashcard_count} cards`);
  }
  assert.deepEqual(cases.map(guide => weakFromGuide(guide, today).percent), [27, 44, 52, 7], 'Learn\'s numbers, not the card count\'s');
  // The recent miss must be a current question: a stale entry at Learning is not a weak idea.
  const stale = guideWith({ quiz: 6, cards: 6, levelsAt: [3, 3], stale: 0 });
  stale.flashcard_progress.learn.levels[50] = { l: 1, at: '2026-11-17', q: 'edited out' };
  assert.equal(weakFromGuide(stale, today), null);
  assert.equal(weakFromGuide({ title: 'No questions', flashcard_progress: { learn: { levels: {} } } }, today), null);
  assert.equal(weakFromGuide(null, today), null);
  // A mastered idea left five days or more fades back to Familiar, as in Learn.
  const fading = guideWith({ quiz: 10, cards: 10, levelsAt: [1, 3, 2, 1] });
  fading.flashcard_progress.learn.levels[1].at = '2026-11-10';
  assert.equal(weakFromGuide(fading, today).percent, examReadiness(fading.quiz_questions, fading.flashcard_progress.learn, today));
  assert.equal(weakFromGuide(fading, today).at, '2026-11-17');
  // The home reads the weak guide in its own load, as it does the exam's; Learn's questions and numbers decide.
  const data = read('lib/homeData.js');
  assert.match(data, /weakFromGuide\(/);
  assert.match(data, /apiFetch\('\/guides\/' \+ encodeURIComponent\(candidate\.guideId\)\)/);
});

test('a weak idea needs a recent miss: older than a week, or nothing at Learning, is not one', () => {
  const guide = levels => ({ id: 'g', title: 'Photosynthesis', flashcard_count: 8, flashcard_progress: { learn: { levels } } });
  assert.equal(weakIdea([guide({ 0: { l: 1, at: '2026-11-10', q: 'a' } })], '2026-11-18'), null, 'eight days ago');
  assert.ok(weakIdea([guide({ 0: { l: 1, at: '2026-11-11', q: 'a' } })], '2026-11-18'), 'seven days ago');
  assert.equal(weakIdea([guide({ 0: { l: 3, at: '2026-11-17', q: 'a' }, 1: { l: 2, at: '2026-11-17', q: 'b' } })], '2026-11-18'), null, 'nothing at Learning');
  assert.equal(weakIdea([{ id: 'g', title: 'No Learn yet', flashcard_count: 5, flashcard_progress: { known: [0] } }], '2026-11-18'), null);
  assert.equal(weakIdea([], '2026-11-18'), null);
  assert.equal(WEAK_DAYS, 7);
  // Of two guides, the one missed most recently.
  const older = { ...guide({ 0: { l: 1, at: '2026-11-14', q: 'a' } }), id: 'older', title: 'Older topic' };
  const newer = { ...guide({ 0: { l: 1, at: '2026-11-17', q: 'a' } }), id: 'newer', title: 'Newer topic' };
  assert.equal(weakIdea([older, newer], '2026-11-18').guideId, 'newer');
  // A saved copy from yesterday is checked again when drawn: a miss from nine days ago is not shown.
  assert.notEqual(homeHeadlineFor({ pick: BIO, info: { weak: { title: 'Old', percent: 10, at: '2026-11-09' } }, now: NOW }).kind, 'weak');
});

test('deadline beats weak idea; with neither (or an exam out of range) one of four class lines, no line under it', () => {
  const info = { deadlines: [{ title: 'Lab report', due_at: at(19).toISOString() }], weak: { title: 'Cell membranes', percent: 40, at: '2026-11-17' } };
  assert.equal(homeHeadlineFor({ pick: BIO, info, now: NOW }).kind, 'deadline');
  assert.equal(homeHeadlineFor({ pick: BIO, info: { weak: info.weak }, now: NOW }).kind, 'weak');
  const lines = new Set();
  for (const key of SAMPLE) {
    const result = homeHeadlineFor({ pick: BIO, info: null, now: NOW, studentKey: key });
    assert.equal(result.kind, 'class');
    assert.equal(result.line, '');
    lines.add(result.title);
  }
  assert.deepEqual([...lines].sort(), ["Let's work on Introduction to Biology", "Picking up Introduction to Biology?", "What's next in Introduction to Biology?", "Where were we in Introduction to Biology?"]);
  assert.equal(homeHeadlineFor({ pick: BIO, info: undefined, now: NOW }).kind, 'class', 'a saved copy from before this change has no per-class facts');
});

test('the same line for a student, class and calendar day; it changes with the class or the day', () => {
  const run = (pick, now = NOW, studentKey = 'student-7') => homeHeadlineFor({ pick, info: null, now, name: 'Jane', studentKey }).title;
  assert.equal(run(BIO), run(BIO));
  assert.equal(run(BIO), run(BIO, new Date(2026, 10, 18, 23, 59)), 'a class line stays all day');
  assert.equal(run(null, new Date(2026, 10, 18, 5, 0)).length > 0, true);
  // Across classes and days, more than one line comes up (a different seed), but each is steady.
  const byClass = new Set(SAMPLE.map(key => run(BIO, NOW, key)));
  assert.ok(byClass.size === 4);
  const days = new Set(Array.from({ length: 14 }, (_, day) => run(BIO, new Date(2026, 10, 1 + day, 9, 0))));
  assert.ok(days.size > 1, 'it changes with the day');
  const classes = new Set(Array.from({ length: 12 }, (_, index) => homeHeadlineFor({ pick: { id: 'class-' + index, name: 'Class number ' + index, code: 'CL ' + (100 + index) }, now: NOW, studentKey: 'student-7' }).title.replace(/Class number \d+/, 'X')));
  assert.ok(classes.size > 1, 'it changes with the class');
  assert.notEqual(headlineSeed('a', 'c1', '2026-11-18'), headlineSeed('a', 'c2', '2026-11-18'));
  assert.notEqual(headlineSeed('a', 'c1', '2026-11-18'), headlineSeed('a', 'c1', '2026-11-19'));
  assert.notEqual(headlineSeed('a', 'c1', '2026-11-18'), headlineSeed('b', 'c1', '2026-11-18'));
  assert.equal(headlineSeed('a', 'c1', '2026-11-18'), headlineSeed('a', 'c1', '2026-11-18'));
  // A neutral greeting is the day's greeting at any hour; a time-of-day one follows the clock.
  const neutral = key => { for (let n = 0; ; n += 1) if (seedOf(`${key}${n}`) % 4 >= 2) return `${key}${n}`; };
  const key = neutral('k');
  assert.equal(homeHeadlineFor({ now: new Date(2026, 10, 18, 6, 0), name: 'Jane', studentKey: key }).title, homeHeadlineFor({ now: new Date(2026, 10, 18, 21, 0), name: 'Jane', studentKey: key }).title);
});

test('the words follow the rules: sentence case, no exclamation marks, no emoji, no guilt or streaks', () => {
  const all = [];
  for (const key of SAMPLE.slice(0, 120)) {
    for (const hour of [2, 8, 14, 19]) all.push(homeHeadlineFor({ now: new Date(2026, 10, 18, hour), name: 'Jane', studentKey: key }));
    all.push(homeHeadlineFor({ pick: BIO, now: NOW, studentKey: key }));
    all.push(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Packback Discussion', due_at: at(20).toISOString() }] }, now: NOW, studentKey: key }));
    all.push(homeHeadlineFor({ pick: BIO, info: { weak: { title: 'Cell structure', percent: 31, at: '2026-11-17' } }, now: NOW, studentKey: key }));
    all.push(homeHeadlineFor({ pick: BIO, info: { exam: { title: 'Exam 3', date: '2026-11-20' }, tally: { total: 9, new: 9, learning: 0, familiar: 0, mastered: 0, fading: 0 } }, now: NOW, studentKey: key }));
  }
  for (const { title, line } of all) {
    for (const text of [title, line]) {
      assert.doesNotMatch(text, /!/, text);
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, text);
      assert.doesNotMatch(text, /streak|don't break|behind|miss(ed)? out|falling|only \d+ days|haven't/i, text);
    }
    assert.match(title, /^[A-Z]/, title);
    assert.doesNotMatch(title, /\b(?:What|Where|Want|Good|Up|Ready)\s+[A-Z][a-z]+\s+(?:are|in|your|another)\b/, 'sentence case: ' + title);
  }
});

test('class words: the picker\'s name, or its code when the name is long or missing', () => {
  assert.equal(classWords(BIO), 'Introduction to Biology');
  assert.equal(classWords({ name: 'Class', code: 'BIO 101' }), 'BIO 101');
  assert.equal(classWords({ name: 'Introduction to Comparative Government and Politics', code: 'POLS 201' }), 'POLS 201');
  assert.equal(classWords({ name: 'Calculus I', code: 'Calculus I' }), 'Calculus I');
  assert.equal(courseCode({ code: 'EH-102-136' }), 'EH 102');
  assert.equal(courseCode({ code: 'BUS 210' }), 'BUS 210');
  assert.equal(courseCode({ code: 'Calculus I' }), 'Calculus I');
  assert.equal(topicName('Midterm: Review'), 'Midterm');
  assert.equal(dayDiff('2026-11-18', '2026-11-21'), 3);
  assert.equal(dayDiff('2026-03-07', '2026-03-09'), 2, 'across the clocks changing');
});

test('Canvas courses are matched to classes by course code, or by name for a class named in words', () => {
  assert.equal(sameClass('MUL-101-102', 'MUL 101 MUL-101-102: Introduction to Music'), true);
  assert.equal(sameClass('BUS-210-004', 'Business Ethics'), false);
  assert.equal(sameClass('BUS 210', 'BUS 210'), true);
  assert.equal(sameClass('BIO-101-002', 'BIO 1010'), false, 'one number off is another class');
  assert.equal(sameClass('Introduction to Music', 'Introduction to Music'), true);
  // Classes named only in words are the same class when the names are, not when one holds the other.
  for (const [course, name] of [['Calculus I', 'Calculus II'], ['Calculus II', 'Calculus I'], ['Adult Health I', 'Adult Health II'], ['Spanish I', 'Spanish II'],
    ['History', 'Art History'], ['Art History', 'History'], ['Chemistry', 'Organic Chemistry'], ['Organic Chemistry', 'Chemistry'], ['Ethics', 'Business Ethics'], ['Business Ethics', 'Ethics'],
    ['Nursing Pharmacology', 'Nursing'], ['Biology Lab', 'Biology'], ['Introduction to Music Theory II', 'Introduction to Music']]) {
    assert.equal(sameClass(course, name), false, `${course} is not ${name}`);
  }
  for (const [course, name] of [['Calculus I', 'Calculus I'], ['calculus i', 'Calculus I'], ['Adult Health II', 'SP25 Adult Health II'], ['Business Ethics', 'Business Ethics (Section 02)']]) {
    assert.equal(sameClass(course, name), true, `${course} is ${name}`);
  }
  // Round 2: what comes after a dash, a colon or a bracket is part of the name unless it is a term or
  // a section. A wrong match puts one class's deadline under another, so when in doubt: no match.
  const PAIRS = [
    // Different classes that share a stem.
    ['Biology - Lab', 'Biology - Lecture', false], ['Biology (Lab)', 'Biology (Lecture)', false], ['Biology [Lab]', 'Biology [Lecture]', false],
    ['Art History: Renaissance', 'Art History: Modern', false], ['Art History', 'Art History: Renaissance to Modern', false],
    ['Nursing - Pharmacology', 'Nursing - Fundamentals', false], ['Nursing', 'Nursing - Pharmacology', false], ['Nursing: Pharmacology', 'Nursing', false],
    ['Business Law - Contracts', 'Business Law - Torts', false], ['English Literature: Victorian', 'English Literature: Modern', false],
    ['Computer Science - Data Structures', 'Computer Science - Algorithms', false], ['Chemistry (Organic)', 'Chemistry (Inorganic)', false],
    ['Spanish - 1', 'Spanish - 2', false], ['Anatomy and Physiology I - Lab', 'Anatomy and Physiology I - Lecture', false],
    ['Psychology - Section 2: Abnormal', 'Psychology - Section 2: Social', false], ['Calculus I', 'Calculus II', false],
    ['Nursing - Lab 101', 'Nursing', false], ['Biology Lab 101', 'Biology Lab 102', false], ['Biology - 101', 'Biology - 102', false], ['Biology - 2035', 'Biology - 2036', false], ['Biology - Fall 2026 - Lab', 'Biology - Fall 2026 - Lecture', false],
    // The same class, with a term or a section the other leaves out.
    ['Calculus II: Section 2', 'Calculus II', true], ['Business Ethics (Section 02)', 'Business Ethics', true], ['Business Ethics', 'Business Ethics (Sec 2)', true],
    ['SP25 Adult Health II', 'Adult Health II', true], ['Adult Health II - Fall 2026', 'Adult Health II', true], ['Biology 2026FA', 'Biology', true],
    ['Biology - Lab (Section 3)', 'Biology - Lab', true], ['Art History: Fall 2026, Section 2', 'Art History', true], ['Nursing Pharmacology - 02', 'Nursing Pharmacology', true],
    ['Calculus II: Section 2 - Fall 2026', 'Calculus II (SP25)', true], ['Biology - Lab - Section 2', 'Biology - Lab', true],
    ['Art History: Renaissance', 'Art History: Renaissance (Spring 2026)', true], ['Introduction to Music', 'MUL 101 MUL-101-102: Introduction to Music', true],
  ];
  assert.ok(PAIRS.length >= 15);
  for (const [course, name, same] of PAIRS) {
    assert.equal(sameClass(course, name), same, `${course} / ${name} should be ${same}`);
    assert.equal(sameClass(name, course), same, `${name} / ${course} should be ${same}`);
  }
  // A code on one side only: the words left once the code is out must be the same.
  assert.equal(sameClass('Calculus I', 'MATH 101 Calculus I'), true);
  assert.equal(sameClass('Calculus I', 'MATH 102 Calculus II'), false);
  assert.equal(sameClass('Introduction to Music', 'MUL 101 MUL-101-102: Introduction to Music'), true);
  assert.equal(sameClass('BIO-101-002', 'Biology'), false);
  assert.equal(sameClass('', 'Business Ethics'), false);
  assert.equal(sameClass(undefined, undefined), false);
  const items = [
    { id: 'a', title: 'Essay', course: 'BUS-210-004', due_at: at(20).toISOString() },
    { id: 'b', title: 'Lab', course: 'BIO-101-002', due_at: at(19).toISOString() },
    { id: 'c', title: 'Quiz', course: 'BUS-210-004', due_at: at(19).toISOString(), all_day: true },
    { id: 'd', title: 'Old', course: 'BUS-210-004', due_at: at(10).toISOString() },
  ];
  assert.deepEqual(classDeadlines('BUS 210', items, NOW).map(item => item.id), ['c', 'a'], 'soonest first, past ones left out');
  assert.equal(classDeadlines('BUS 210', items, NOW)[0].all_day, true);
  assert.deepEqual(classDeadlines('Chemistry', items, NOW), []);
});

test('a course code the title already starts with is not said twice', () => {
  assert.equal(assignmentName('NUR 220 Week 5 Discussion: Care of the Patient Receiving Anticoagulant Therapy', 'NUR 220'), 'Week 5 Discussion');
  assert.equal(assignmentName('NUR 220 Week 5 Discussion', 'NUR 220'), 'Week 5 Discussion');
  assert.equal(assignmentName('NUR-220: Week 5 Discussion', 'NUR 220'), 'Week 5 Discussion');
  assert.equal(assignmentName('A05 NUR 220 Week 5 Discussion', 'NUR 220'), 'Week 5 Discussion');
  assert.equal(assignmentName('NUR 210 Week 5 Discussion', 'NUR 220'), 'NUR 210 Week 5 Discussion', 'another class\'s code stays');
  assert.equal(assignmentName('NUR 220', 'NUR 220'), '', 'nothing left but the code');
  assert.equal(assignmentName('Week 5 Discussion', 'NUR 220'), 'Week 5 Discussion');
  const nur = { id: 'f-nur', name: 'Pharmacology', code: 'NUR 220' };
  const result = homeHeadlineFor({ pick: nur, info: { deadlines: [{ title: 'NUR 220 Week 5 Discussion: Care of the Patient Receiving Anticoagulant Therapy', due_at: at(20).toISOString() }] }, now: NOW });
  assert.equal(result.title, nb('Week 5 Discussion for NUR 220 is due Friday.'));
  assert.equal(homeHeadlineFor({ pick: nur, info: { deadlines: [{ title: 'NUR 220', due_at: at(20).toISOString() }] }, now: NOW }).title, nb('Your next assignment for NUR 220 is due Friday.'));
});

test('an assignment keeps its own case: no half-lowercased titles', () => {
  assert.equal(assignmentName('Visual Analysis Paper: Caravaggio\'s The Calling of Saint Matthew'), 'Visual Analysis Paper');
  assert.equal(assignmentName('Final Exam Review Worksheet — Chapters 12 through 18 (Pharmacology)'), 'Final Exam Review Worksheet');
  assert.equal(assignmentName('Close Reading: Toni Morrison\'s Beloved, Chapters 1-3'), 'Close Reading');
  assert.equal(assignmentName('Packback discussion'), 'Packback discussion');
  assert.equal(assignmentName('Lab report'), 'Lab report');
  // The Plan label's own wording (lib/homeText.mjs planTitle) is unchanged.
  assert.equal(planTitle('Packback Discussion'), 'Packback discussion');
});

test('a course code stays on one line: a no-break space between its department and number', () => {
  const nbsp = ' ';
  const result = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Packback Discussion', due_at: at(20).toISOString() }] }, now: NOW });
  assert.ok(result.title.includes(`BUS${nbsp}210`), JSON.stringify(result.title));
  assert.doesNotMatch(result.title, /BUS 210/);
  const weak = homeHeadlineFor({ pick: BIO, info: { weak: { title: 'Cells', percent: 20, at: '2026-11-17' } }, now: NOW });
  assert.equal(weak.line, `20% ready in BIO${nbsp}101`);
  const exam = homeHeadlineFor({ pick: { id: 'f', name: 'Introduction to Comparative Government and Politics', code: 'POLS 201' }, info: { exam: { title: 'Midterm', date: '2026-11-20' } }, now: NOW });
  assert.equal(exam.title, `Friday is your POLS${nbsp}201 exam.`);
  assert.equal(homeHeadlineFor({ pick: { id: 'f', name: 'Class', code: 'ENG 220' }, now: NOW, studentKey: 'a' }).title.includes('ENG 220'), false, 'a class line too');
});

test('a cut name stops before a trailing small word or an open bracket', () => {
  assert.equal(shortenName('Essay 2: Unreliable Narrators in The Great Gatsby and Wuthering Heights'), 'Essay 2: Unreliable Narrators…');
  assert.equal(shortenName('Dynamic Programming (Knapsack, LCS, Edit Distance)'), 'Dynamic Programming…');
  assert.equal(shortenName('Implementing a Hash Table with Linear Probing for Collisions'), 'Implementing a Hash Table with Linear…');
  assert.equal(shortenName('Annotated Bibliography for the Harlem Renaissance Research Paper'), 'Annotated Bibliography for the Harlem…');
  assert.equal(shortenName('Reading Response on the Role of the Narrator in Modern Fiction'), 'Reading Response on the Role…', 'no trailing "of the"');
  for (const text of ['Essay 2: Unreliable Narrators in The Great Gatsby and Wuthering Heights', 'Dynamic Programming (Knapsack, LCS, Edit Distance)', 'Reading Response on the Role of the Narrator in Modern Fiction']) {
    const cut = shortenName(text);
    assert.ok(cut.length <= 40, cut);
    assert.doesNotMatch(cut, /\s(?:a|an|and|as|at|by|for|in|of|on|or|the|to|with)…$/i, cut);
    assert.doesNotMatch(cut, /\([^)]*…$/, cut);
  }
  assert.equal(shortenName('Quiz 4'), 'Quiz 4');
  assert.equal(shortenName('x'.repeat(60)).length, 40);
});

test('the first name: more titles go, an address or a placeholder is no name', () => {
  assert.equal(firstName('Sr. Maria Lopez'), 'Maria');
  assert.equal(firstName('Rev. John Adams'), 'John');
  assert.equal(firstName('Fr. Thomas Reilly'), 'Thomas');
  assert.equal(firstName('Sir Ian McKellen'), 'Ian');
  assert.equal(firstName('Sra. Elena Ruiz'), 'Sra', 'only the listed titles');
  for (const bad of ['jane.doe', 'jane_doe', 'jane.doe smith', 'User', 'user', 'New User', 'Student', 'Cordia Student', 'Test Student', 'Anonymous', 'Guest', 'null', 'undefined']) assert.equal(firstName(bad), '', bad);
  assert.equal(firstName('Jane Smith'), 'Jane');
  assert.equal(firstName('Mary-Kate O\'Neil'), 'Mary-Kate');
  assert.equal(firstName('Jean-Luc Picard'), 'Jean-Luc');
});

test('the headline changes when the clock does: the next 5:00, noon, 5 PM, 11 PM or midnight, or a deadline passing', () => {
  const wait = (date, info) => nextHeadlineChange(date, info);
  const minutes = ms => Math.round(ms / 60000);
  assert.equal(minutes(wait(new Date(2026, 10, 22, 22, 58))), 2, '22:58 -> 23:00');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 23, 30))), 30, '23:30 -> midnight');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 4, 30))), 30, '4:30 -> 5:00');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 9, 0))), 180, '9:00 -> noon');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 12, 0))), 300, 'noon -> 5 PM');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 17, 0))), 360, '5 PM -> 11 PM');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 0, 0))), 300, 'midnight -> 5:00');
  assert.ok(wait(new Date(2026, 10, 22, 22, 59, 59, 999)) >= 1, 'never zero');
  // A deadline that passes before the next boundary is a boundary too: its headline goes when it is due.
  const info = { deadlines: [{ title: 'Quiz', due_at: new Date(2026, 10, 22, 10, 0).toISOString() }, { title: 'Later', due_at: new Date(2026, 10, 22, 15, 0).toISOString() }] };
  assert.equal(minutes(wait(new Date(2026, 10, 22, 9, 0), info)), 60);
  assert.equal(minutes(wait(new Date(2026, 10, 22, 10, 30), info)), 90, 'noon comes first, the 3 PM deadline after');
  assert.equal(minutes(wait(new Date(2026, 10, 22, 9, 0), { deadlines: [{ title: 'No time', due_at: new Date(2026, 10, 22, 10, 0).toISOString(), all_day: true }] })), 180, 'an all-day item has no hour');
  // Each boundary really changes a time-of-day greeting.
  const key = (() => { for (let n = 0; ; n += 1) if (headlineSeed(`s${n}`, '', '2026-11-22') % 4 < 2) return `s${n}`; })();
  const say = (day, hour, minute) => homeHeadlineFor({ now: new Date(2026, 10, day, hour, minute), name: 'Jane', studentKey: key }).title;
  assert.notEqual(say(22, 22, 59), say(22, 23, 0));
  assert.equal(say(22, 23, 0), 'Up late, Jane?');
  assert.equal(say(22, 23, 59), say(22, 23, 0));
});

test('the home takes the headline from the picker, with no extra load, and fades it in 150ms', () => {
  const home = read('pages/home.js');
  const data = read('lib/homeData.js');
  const hero = read('components/HomeHero.js');
  const css = read('styles/system.css');
  assert.match(home, /pickedInfo = picked \? data\?\.byClass/);
  assert.match(home, /homeHeadlineFor\(\{[^}]*pick: picked[^}]*info: pickedInfo/);
  assert.match(home, /\[picked, data, clock\]/, 'worked out again when the class, the loaded data or the clock changes');
  assert.match(home, /nextHeadlineChange\(new Date\(\), pickedInfo\)/, 'a timer to the next change');
  assert.match(home, /addEventListener\('visibilitychange'/, 'checked again when the tab comes back');
  assert.match(home, /<HomeHero key="hero" title=\{headline\.title\} line=\{headline\.line\} clock=\{clock\} \/>/);
  assert.match(hero, /seen\.clock !== clock/, 'a change the clock made does not fade');
  // Every class's facts come with the home's own load; the picker's change asks for nothing.
  assert.match(data, /byClass/);
  assert.doesNotMatch(home, /apiFetch|loadHome\([^)]*classId/);
  assert.match(hero, /HERO_FADE_MS = 150/);
  assert.match(hero, /prefers-reduced-motion: reduce/);
  assert.match(hero, /lastInput\.keyboard \|\|/, 'a change made from the keyboard is instant');
  assert.match(hero, /aria-hidden="true"/, 'the fading copy is hidden from assistive tech');
  assert.match(css, /\.chat-home-copy\.is-entering \{[^}]*150ms/);
  assert.match(css, /\.chat-home-copy\.is-leaving \{[^}]*150ms/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[\s\S]*?\.chat-home-copy\.is-entering, \.chat-home-copy\.is-leaving \{ animation: none; \}/);
});

test('round 2: a title and one word, or a title alone, is no first name', () => {
  for (const bad of ['Dr. Smith', 'Dr Smith', 'Ms.', 'Dr', 'Mr. Okafor', 'Prof. Dr. Lindqvist', 'Mrs', 'Sir Ian', 'Dr. Smith Jr.', 'Prof.', 'Professor']) assert.equal(firstName(bad), '', bad);
  assert.equal(firstName('Dr. Amara Okafor'), 'Amara');
  assert.equal(firstName('Ms. Jane Smith'), 'Jane');
  assert.equal(firstName('Prof. Dr. Amara Okafor'), 'Amara');
  assert.equal(firstName('Jane Smith Jr.'), 'Jane');
  assert.equal(firstName('Drew Carter'), 'Drew', 'a name that only starts like a title');
  assert.equal(firstName('Mia'), 'Mia');
});

test('round 2: a cut treats "[" like "(", and a bracket never leaves a stub', () => {
  assert.equal(shortenName('Dynamic Programming [Knapsack, LCS, Edit Distance]'), 'Dynamic Programming…');
  assert.equal(shortenName('Dynamic Programming (Knapsack, LCS, Edit Distance)'), 'Dynamic Programming…');
  for (const text of ['Lab (Something very long and detailed that goes on and on)', 'Lab [Something very long and detailed that goes on and on]', 'Quiz (Chapters one through five and the appendix)']) {
    const cut = shortenName(text);
    assert.notEqual(cut, 'Lab…', text);
    assert.notEqual(cut, 'Quiz…', text);
    assert.ok(cut.length > 12 && cut.length <= 40, `${text} -> ${cut}`);
    assert.ok(cut.startsWith(text.slice(0, 8)) && cut.endsWith('…'), cut);
  }
  assert.equal(shortenName('Lab (Short)'), 'Lab (Short)');
});

test('round 2: the old copy leaves when its animation ends, with a timer only as a fallback', () => {
  const hero = read('components/HomeHero.js');
  assert.match(hero, /onAnimationEnd=\{\(\) => dropPrevious\(previous\.key\)\}/, 'removed on animationend');
  assert.match(hero, /HERO_FALLBACK_MS = HERO_FADE_MS \+ 50/, 'a fallback a little longer than the fade');
  assert.match(hero, /setTimeout\(\(\) => dropPrevious\(previous\.key\), HERO_FALLBACK_MS\)/);
  assert.doesNotMatch(hero, /setTimeout\([^;]*HERO_FADE_MS\)/, 'no timer as short as the fade itself');
  assert.match(hero, /fade = [^;]*!quiet\(\)/, 'reduced motion: no old copy at all');
});
