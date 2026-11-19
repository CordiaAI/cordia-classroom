// The home's suggestions (lib/homeText.mjs): the Plan label names the class and reads in plain
// words, the due-flashcards label counts what is due, and that button starts a round of 50 cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classShort, homeSuggestions, planLabel, planTitle } from '../lib/homeText.mjs';
import { DUE_REVIEW_CARDS, buildStudyQueue, cardLimit } from '../lib/studyQueue.mjs';

const plan = (title, course) => planLabel({ title, course });

test('the Plan label names the class and drops ids and numbering, keeping the meaning', () => {
  assert.equal(plan('Packback Discussion #12', 'EH-101-136'), "Plan EH 101's Packback discussion");
  assert.equal(plan('Packback #9', 'REL-200-101'), "Plan REL 200's Packback");
  assert.equal(plan('Concert Report #2', 'MUL-101-102'), "Plan MUL 101's Concert report");
  assert.equal(plan('A05 Seven Ethical Frameworks Quiz', 'BUS-101-101'), "Plan BUS 101's Seven Ethical Frameworks quiz");
  assert.equal(plan('A07AA Rough Draft, Resume', 'BUS-101-101'), "Plan BUS 101's Rough Draft, Resume");
  assert.equal(plan('Reading response 8', 'ENG-102-104'), "Plan ENG 102's Reading response");
  assert.equal(plan('Lab report', 'BIO-101'), "Plan BIO 101's Lab report");
  assert.equal(plan('Essay 2', 'ENG-101-004'), "Plan ENG 101's essay");
  assert.equal(plan('Discussion 3: Ethics in Nursing', 'NUR-220'), "Plan NUR 220's Discussion: Ethics in Nursing");
  assert.equal(plan('Midterm Exam', 'HIS-110'), "Plan HIS 110's Midterm exam");
});

test('the meaning stays: part numbers like Week 5 or Chapter 4 are not numbering', () => {
  assert.equal(plan('Week 5 Discussion', 'PSY-101'), "Plan PSY 101's Week 5 discussion");
  assert.equal(plan('Chapter 4 Quiz #2', 'CHM-111'), "Plan CHM 111's Chapter 4 quiz");
  assert.equal(plan('Case Study - Pharmacology', 'NUR-230'), "Plan NUR 230's Case Study: Pharmacology");
});

test('a section code in the title or a class name is read, and a missing class says "your"', () => {
  assert.equal(plan('Lab report [BIO-101-002]', ''), 'Plan your Lab report');
  assert.equal(planTitle('Lab report [BIO-101-002]'), 'Lab report');
  assert.equal(plan('Packback #12', 'EH 101'), "Plan EH 101's Packback");
  assert.equal(plan('Packback #12', 'Introduction to Music'), "Plan Introduction to Music's Packback");
  assert.equal(plan('Quiz 3', 'S1-FA24'), 'Plan your quiz');
  assert.equal(plan('Quiz 3', 'Fall 2024'), 'Plan your quiz');
  assert.equal(plan('Quiz 3', 'Statistics for Nurses'), "Plan Statistics for Nurses' quiz");
});

test('nothing left of the title still reads as a sentence', () => {
  assert.equal(plan('A05', 'BUS-101-101'), "Plan BUS 101's next assignment");
  assert.equal(plan('#12', ''), 'Plan your next assignment');
  assert.equal(plan('', 'BUS-101-101'), "Plan BUS 101's next assignment");
});

test('the class is the department and level, however the course is written', () => {
  assert.equal(classShort('EH-102-136'), 'EH 102');
  assert.equal(classShort('MUL 101 MUL-101-102: Introduction to Music'), 'MUL 101');
  assert.equal(classShort('bio101'), 'BIO 101');
  assert.equal(classShort('CHEM-2210L-01'), 'CHEM 2210L');
  assert.equal(classShort(''), '');
});

test('copy rules: sentence case, no exclamation marks, numerals, nothing over a line long', () => {
  const titles = ['Packback Discussion #12', 'Concert Report #2', 'A05 Seven Ethical Frameworks Quiz', 'Reading response 8', 'Annotated Bibliography for the Harlem Renaissance research paper #3'];
  for (const title of titles) {
    const label = plan(title, 'EH-101-136');
    assert.doesNotMatch(label, /!|#\d/, label);
    assert.match(label, /^Plan EH 101's /, label);
    assert.ok(label.length <= 60, label);
  }
  assert.ok(plan('Annotated Bibliography for the Harlem Renaissance research paper', 'EH-101').endsWith('…'));
});

test('the due pill counts what is due and starts a round capped at 50 cards', () => {
  assert.equal(homeSuggestions({ due: 688 })[0].label, 'Review flashcards (688 due)');
  assert.equal(homeSuggestions({ due: 1204 })[0].label, 'Review flashcards (1,204 due)');
  assert.equal(homeSuggestions({ due: 1 })[0].label, 'Review flashcards (1 due)');
  assert.equal(homeSuggestions({ due: 0 }).length, 0);
  assert.equal(DUE_REVIEW_CARDS, 50);
  assert.equal(homeSuggestions({ due: 688 })[0].href, '/session?cards=50');
  const label = homeSuggestions({ due: 688 })[0].label;
  assert.doesNotMatch(label, /!/);
});

// 688 cards due across a few guides, none ever reviewed (a new card is due).
const guide = (id, count) => ({ id, title: `Guide ${id}`, flashcards: Array.from({ length: count }, (_, index) => ({ front: `Q ${id}-${index}`, back: `A ${id}-${index}` })), flashcard_progress: {} });
const guides = [guide('a', 300), guide('b', 250), guide('c', 138)];

test('688 due starts 50 cards from the button, and the usual 30 otherwise', () => {
  const href = new URL(homeSuggestions({ due: 688 })[0].href, 'https://example.test');
  const asked = cardLimit(href.searchParams.get('cards'));
  assert.equal(asked, 50);
  const queue = buildStudyQueue(guides, {}, { today: '2026-11-18', cards: asked });
  assert.equal(queue.cardTotal, 688);
  assert.equal(queue.items.filter(item => item.kind === 'card').length, 50);
  assert.equal(buildStudyQueue(guides, {}, { today: '2026-11-18' }).items.filter(item => item.kind === 'card').length, 30, 'Study now elsewhere is unchanged');
});

test('?cards= is a whole number from 1 to 100, and anything else falls back to 30', () => {
  assert.equal(cardLimit('50'), 50);
  assert.equal(cardLimit('500'), 100);
  assert.equal(cardLimit('1'), 1);
  for (const bad of [undefined, '', '0', '-5', '12.5', 'abc', '50; drop', null]) assert.equal(cardLimit(bad), 30, String(bad));
});
