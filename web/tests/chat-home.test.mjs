// The chat home (docs/redesign/PLAN.md T3) and the composer (T4): the headline, the suggestion
// pills, and what Send does with a message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_HEADLINE, asksForGuide, composerAction, examDay, firstLink, homeHeadline, homeSuggestions, pastedMaterial } from '../lib/homeText.mjs';
import { counts, restoreLevels, testPlan } from '../lib/learnEngine.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the headline names an exam within a week, with ideas left and today\'s pace', () => {
  const exam = { title: 'Exam 3', date: '2026-11-19', daysLeft: 2 };
  assert.deepEqual(homeHeadline(exam, { remaining: 30, perDay: 10, past: false }, 'Calculus I'), {
    title: 'Thursday is your Calculus I exam.',
    line: '30 ideas left to master. 10 today keeps you on pace.',
  });
  assert.equal(homeHeadline({ ...exam, daysLeft: 1 }, null, 'Calculus I').title, 'Tomorrow is your Calculus I exam.');
  assert.equal(homeHeadline({ ...exam, daysLeft: 0 }, null, 'Calculus I').title, 'Today is your Calculus I exam.');
  assert.equal(homeHeadline(exam, { remaining: 1, perDay: 1 }, 'Composition I').line, '1 idea left to master. 1 today keeps you on pace.');
  assert.equal(homeHeadline(exam, { remaining: 0, perDay: 0 }, 'Composition I').line, 'Every idea is mastered. A short review keeps it that way.');
  assert.equal(homeHeadline(exam, null, '').title, 'Thursday is Exam 3.');
});

test('with no exam in the next 7 days it asks what you are studying, with no second line', () => {
  assert.deepEqual(homeHeadline(null, null), { title: EMPTY_HEADLINE, line: '' });
  assert.deepEqual(homeHeadline({ title: 'Midterm', date: '2026-11-27', daysLeft: 10 }, { remaining: 5, perDay: 1 }, 'Biology'), { title: 'What are you studying?', line: '' });
  assert.equal(examDay('2026-11-16', 3), 'Monday');
});

test('the pace is Learn\'s own: ideas not yet mastered, spread over the days before the exam', () => {
  const questions = Array.from({ length: 12 }, (_, index) => ({ question: `What does the derivative of x^${index + 2} equal?`, options: [`${index + 2}x^${index + 1}`], correct_index: 0 }));
  const tally = counts(questions, restoreLevels(questions, {}), '2026-11-17');
  const plan = testPlan(tally, '2026-11-19', '2026-11-17');
  assert.equal(homeHeadline({ title: 'Exam 3', date: '2026-11-19', daysLeft: 2 }, plan, 'Calculus I').line, `${plan.remaining} ideas left to master. ${plan.perDay} today keeps you on pace.`);
});

test('up to three pills in the spec\'s order, leaving out any with nothing behind it', () => {
  const all = homeSuggestions({
    learn: { title: 'Exam 3', guideId: 'g-calc-review', date: '2026-11-19' },
    due: 14,
    deadline: { title: 'Career portfolio', course: 'BUS-210-004' },
  });
  assert.deepEqual(all.map(pill => pill.label), ['Start Learn for Exam 3', 'Review flashcards (14 due)', "Plan BUS 210's Career portfolio"]);
  assert.equal(all[0].href, '/learn/g-calc-review?test=2026-11-19');
  assert.equal(all[1].href, '/session?cards=50');
  assert.equal(all[2].href, undefined);
  assert.deepEqual(homeSuggestions({ due: 1 }).map(pill => pill.label), ['Review flashcards (1 due)']);
  assert.deepEqual(homeSuggestions({}), []);
  assert.ok(homeSuggestions({ deadline: { title: 'Annotated bibliography for the Harlem Renaissance research paper' } })[0].label.endsWith('…'));
});

test('Send asks the Tutor, or builds a guide through the New sheet when asked to', () => {
  assert.deepEqual(composerAction('Why does the chain rule work?', 0), { kind: 'ask' });
  assert.deepEqual(composerAction('Quiz me on these slides', 2), { kind: 'ask' });
  assert.deepEqual(composerAction('Make a guide from these', 2), { kind: 'guide', mode: 'upload' });
  assert.deepEqual(composerAction('', 1), { kind: 'guide', mode: 'upload' });
  assert.deepEqual(composerAction('make a study guide from https://openstax.org/books/biology/pages/5-1-components', 0),
    { kind: 'guide', mode: 'link', url: 'https://openstax.org/books/biology/pages/5-1-components' });
  const notes = 'Make a guide from my notes\n' + 'Supply and demand set the market price where the quantity buyers want equals what sellers offer. '.repeat(3);
  assert.equal(composerAction(notes, 0).mode, 'paste');
  assert.deepEqual(composerAction('Make a study guide', 0), { kind: 'new-sheet' });
  assert.deepEqual(composerAction('   ', 0), { kind: 'none' });
});

test('guide requests, links and pasted notes are read across subjects', () => {
  for (const ask of ['Turn these lecture slides into a study guide', 'Can you build a guide for Exam 2?', 'create guides from this']) assert.ok(asksForGuide(ask), ask);
  for (const ask of ['Guide me through problem 4', 'What does the guide say about tort law?', 'Explain the Krebs cycle']) assert.ok(!asksForGuide(ask), ask);
  assert.equal(firstLink('Read https://plato.stanford.edu/entries/kant-moral/, then quiz me.'), 'https://plato.stanford.edu/entries/kant-moral/');
  assert.equal(firstLink('no link here'), '');
  assert.equal(pastedMaterial('Make a guide\nshort'), '');
});

test('the composer reuses the Tutor client and the New sheet; plan limits keep what was typed', () => {
  const composer = read('components/Composer.js');
  assert.match(composer, /openNewSheet\('upload', \{ \.\.\.options, files \}\)/);
  assert.match(composer, /event\.key === 'Enter' && !event\.shiftKey/);
  assert.match(composer, /const MAX_HEIGHT = LINE \* 8 \+ PAD;/);
  const hook = read('lib/useTutorChat.js');
  assert.match(hook, /apiFetch\('\/chat'/);
  assert.match(hook, /class_id: needsTargetClass \? targetClassId : scopeClassId \|\| material\?\.folder_id \|\| undefined/);
  // A 402 restores the question to the box; its detail is a message object, never rendered raw.
  // (A spoken turn in voice mode, F11, never writes over what is in the box.)
  assert.match(hook, /const message = data\?\.answer \|\| apiErrorMessage\(data\?\.detail[^\n]*\n      setSession\(current\);\n      if \(!voice\) setInput\(question\);\n      setLocalError\(message\);/);
  assert.match(read('components/AIChatWidget.js'), /useTutorChat\(props\)/);
  assert.match(read('components/NewSheet.js'), /setAutoCreate\(Boolean\(event\.detail\?\.create\)\)/);
});
