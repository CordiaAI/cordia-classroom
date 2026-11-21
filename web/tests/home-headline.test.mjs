// The home headline by class picker (FEEDBACK-BATCH-1 H1): the greeting for All classes, and for a
// picked class the exam, the deadline, the weak idea or a plain line, in that order; the same line
// for a student, class and day; the motion and the words' rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEADLINE_DAYS, WEAK_DAYS, classDeadlines, classWords, courseCode, dayDiff, dayPart, firstName, greeting, headlineSeed, homeHeadlineFor,
  assignmentName, sameClass, seedOf, shortenName, topicName, weakIdea,
} from '../lib/homeHeadline.mjs';

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
  assert.equal(firstName('Test Student'), 'Test');
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
  assert.deepEqual(result, { title: 'Packback discussion for BUS 210 is due Friday.', line: `Due Friday at ${clock(due)}`, kind: 'deadline' });
  const tomorrow = at(19, 17, 0);
  const next = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Career portfolio', due_at: tomorrow.toISOString() }] }, now: NOW });
  assert.deepEqual([next.title, next.line], ['Career portfolio for BUS 210 is due tomorrow.', `Due tomorrow at ${clock(tomorrow)}`]);
  const later = at(18, 20, 0);
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Quiz 4', due_at: later.toISOString() }] }, now: NOW }).title, 'Quiz 4 for BUS 210 is due today.');
  // An all-day item has no time to give.
  const allDay = homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'Reading response', due_at: at(21, 0, 0).toISOString(), all_day: true }] }, now: NOW });
  assert.deepEqual([allDay.title, allDay.line], ['Reading response for BUS 210 is due Saturday.', 'Due Saturday']);
  assert.equal(DEADLINE_DAYS, 3);
});

test('the soonest deadline inside the window is the one named; one that has passed or is four days out is not', () => {
  const info = { deadlines: [
    { title: 'Late one', due_at: at(21).toISOString() },
    { title: 'Already due', due_at: at(18, 8, 0).toISOString() },
    { title: 'Soon one', due_at: at(19).toISOString() },
  ] };
  assert.equal(homeHeadlineFor({ pick: BUS, info, now: NOW }).title, 'Soon one for BUS 210 is due tomorrow.');
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
  assert.equal(result.title, 'Annotated Bibliography for the Harlem… for BUS 210 is due Friday.');
  // A long name with a colon keeps the part that stands alone, in plain words; a short one keeps all of it.
  assert.equal(assignmentName('A05 Packback Discussion: Seven Ethical Frameworks and the Case for Stakeholder Theory [BUS-210-004]'), 'Packback discussion');
  assert.equal(assignmentName('Quiz 4: Chapters 5 to 7'), 'Quiz 4: Chapters 5 to 7');
  assert.equal(assignmentName(long), 'Annotated Bibliography for the Harlem…');
  assert.ok(assignmentName('Reflection: ' + 'x'.repeat(50)).length <= 40);
  // Only an id left: the sentence still reads.
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'NUR-210-01 [A05]', due_at: at(20).toISOString() }] }, now: NOW }).title, 'Your next assignment for BUS 210 is due Friday.');
  assert.equal(homeHeadlineFor({ pick: BUS, info: { deadlines: [{ title: 'quiz 4', due_at: at(20).toISOString() }] }, now: NOW }).title, 'Quiz 4 for BUS 210 is due Friday.');
});

test('a weak idea from Learn: the guide\'s topic name, never a raw question, with the guide\'s readiness', () => {
  const levels = {
    0: { l: 1, at: '2026-11-17', q: 'what is the role of the cell membrane' },
    1: { l: 3, at: '2026-11-16', q: 'what organelle makes atp' },
    2: { l: 2, at: '2026-11-12', q: 'what is osmosis' },
    3: { l: 1, at: '2026-11-16', q: 'what does the nucleus store' },
  };
  const guide = { id: 'g-cells', title: 'Cell Structure and Transport: review', folder_id: 'f-bio', flashcard_count: 10, flashcard_progress: { learn: { levels } } };
  const found = weakIdea([guide], '2026-11-18');
  assert.deepEqual(found, { guideId: 'g-cells', title: 'Cell Structure and Transport', percent: 18, at: '2026-11-17' });
  const result = homeHeadlineFor({ pick: BIO, info: { weak: found }, now: NOW });
  assert.deepEqual(result, { title: 'Want another look at Cell Structure and Transport?', line: '18% ready in BIO 101', kind: 'weak' });
  assert.ok(!Object.values(levels).some(entry => result.title.includes(entry.q)), 'no raw question');
  // 1 mastered, 1 familiar and 2 at Learning of 10 ideas: (1 + 0.5 + 2 * 0.15) / 10, Learn's own weights.
  assert.equal(found.percent, 18);
  // A mastered idea left five days or more fades back to Familiar, as in Learn: (0.5 + 0.5 + 0.3) / 10.
  const fading = { ...guide, flashcard_progress: { learn: { levels: { ...levels, 1: { l: 3, at: '2026-11-10', q: 'what organelle makes atp' } } } } };
  assert.equal(weakIdea([fading], '2026-11-18').percent, 13);
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

test('the home takes the headline from the picker, with no extra load, and fades it in 150ms', () => {
  const home = read('pages/home.js');
  const data = read('lib/homeData.js');
  const hero = read('components/HomeHero.js');
  const css = read('styles/system.css');
  assert.match(home, /homeHeadlineFor\(\{[^}]*pick: picked[^}]*info: picked \? data\?\.byClass/);
  assert.match(home, /<HomeHero key="hero" title=\{headline\.title\} line=\{headline\.line\} \/>/);
  assert.match(home, /\[picked, data\]/, 'worked out again when the class or the loaded data changes');
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
