// The home's suggestions (lib/homeText.mjs): the Plan label names the class and reads in plain
// words, the due-flashcards label counts what is due, and that button starts a round of 50 cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classShort, homeSuggestions, planLabel, planTitle } from '../lib/homeText.mjs';
import { DUE_REVIEW_CARDS, buildStudyQueue, cardLimit } from '../lib/studyQueue.mjs';

const plan = (title, course) => planLabel({ title, course });

test('the Plan label names the class and drops ids, keeping the meaning and the number', () => {
  assert.equal(plan('Packback Discussion #12', 'EH-101-136'), "Plan EH 101's Packback discussion");
  assert.equal(plan('Packback #9', 'REL-200-101'), "Plan REL 200's Packback");
  assert.equal(plan('Concert Report #2', 'MUL-101-102'), "Plan MUL 101's Concert report");
  assert.equal(plan('A05 Seven Ethical Frameworks Quiz', 'BUS-101-101'), "Plan BUS 101's Seven Ethical Frameworks quiz");
  assert.equal(plan('A07AA Rough Draft, Resume', 'BUS-101-101'), "Plan BUS 101's Rough Draft, Resume");
  assert.equal(plan('Lab report', 'BIO-101'), "Plan BIO 101's Lab report");
  assert.equal(plan('Midterm Exam', 'HIS-110'), "Plan HIS 110's Midterm exam");
  assert.equal(plan('Case Study - Pharmacology', 'NUR-230'), "Plan NUR 230's Case Study: Pharmacology");
});

test('the number after a work word stays: Quiz 4, Lab 3, Problem Set 4, Exam 3', () => {
  for (const title of ['Quiz 4', 'Lab 3', 'Problem Set 4', 'Exam 3', 'Test 2', 'Midterm 2', 'Essay 2', 'Reading response 8', 'Discussion 3: Ethics in Nursing', 'Exam 3: Cardiac', 'Module 3 Quiz 2', 'Lab 07: Pointers']) {
    assert.equal(planTitle(title).replace(/: .*/, ''), title.replace(/: .*/, ''), title);
  }
  assert.equal(planTitle('Exam 1 (1 of 2)'), 'Exam 1');
  assert.equal(planTitle('Care Plan 2 - Heart Failure'), 'Care Plan 2: Heart Failure');
  assert.equal(plan('Quiz 4', 'NUR-210'), "Plan NUR 210's Quiz 4");
});

test('part words are not ids: Wk5, Ch5, Pt2, U2, Week 5, Part 2 stay', () => {
  assert.equal(planTitle('Wk5 Discussion'), 'Wk5 discussion');
  assert.equal(planTitle('Ch5 Reading Quiz'), 'Ch5 Reading quiz');
  assert.equal(planTitle('U2 Test'), 'U2 test');
  assert.equal(planTitle('Pt2 Final Paper'), 'Pt2 Final paper');
  assert.equal(planTitle('Week 5 Discussion'), 'Week 5 discussion');
  assert.equal(planTitle('Group Project Part 2'), 'Group Project Part 2');
  assert.equal(planTitle('Wk 5 Discussion'), 'Wk 5 discussion');
  assert.equal(planTitle('A1C Lab Report'), 'A1C Lab report', 'a lab value is not an id');
  assert.equal(planTitle('B12 Deficiency Case Study'), 'B12 Deficiency Case Study');
});

test('an id goes only when words follow; a title of only codes falls back to "next assignment"', () => {
  assert.equal(planTitle('PA3: Hash Tables'), 'Hash Tables');
  assert.equal(planTitle('HW3 Review'), 'review');
  for (const title of ['HW3', 'A05', 'Q1', '#12', 'NUR-210-01 [A05]', 'ENG-101-004', 'NUR-210-01', '']) {
    assert.equal(planTitle(title), '', title);
    assert.equal(plan(title, 'NUR-210'), "Plan NUR 210's next assignment", title);
  }
  assert.equal(planTitle('Catch-22 Discussion'), 'Catch-22 discussion', 'a hyphenated name is not a section code');
  assert.equal(planTitle('COVID-19 Reflection'), 'COVID-19 reflection');
});

test('only a fully Title Case title gets its last work noun lowercased', () => {
  assert.equal(planTitle('Packback Discussion'), 'Packback discussion');
  assert.equal(planTitle('Hamlet Act 3 Response'), 'Hamlet Act 3 response');
  assert.equal(planTitle('Annotated Bibliography for the Harlem Renaissance Paper'), 'Annotated Bibliography for the Harlem Renaissance paper');
  assert.equal(planTitle('Annotated bibliography for the Harlem Renaissance Paper'), 'Annotated bibliography for the Harlem Renaissance Paper', 'a lowercase word: case left alone');
  assert.equal(planTitle('iPad Lab Report'), 'iPad Lab Report');
  assert.equal(planTitle('Lab report'), 'Lab report');
  assert.equal(planTitle('FINAL EXAM'), 'FINAL EXAM');
  assert.equal(planTitle('Case Brief 4: Hadley v. Baxendale'), 'Case Brief 4: Hadley v. Baxendale');
});

test('realistic titles: nursing, art history, business law, literature, computer science', () => {
  const titles = {
    'NCLEX Practice Quiz 4': 'NCLEX Practice Quiz 4',
    'Med-Surg Clinical Reflection 3': 'Med-Surg Clinical Reflection 3',
    'Care Plan 2 - Heart Failure': 'Care Plan 2: Heart Failure',
    'Visual Analysis Paper 2: Caravaggio': 'Visual Analysis Paper 2: Caravaggio',
    'Baroque Art Response - Week 9': 'Baroque Art Response: Week 9',
    'Contracts Memo 1': 'Contracts Memo 1',
    'UCC Article 2 Quiz': 'UCC Article 2 quiz',
    'Sonnet 18 Close Reading': 'Sonnet 18 Close reading',
    'Essay 2 (Draft)': 'Essay 2 (Draft)',
    '1984 Essay': '1984 essay',
    'Title IX Training': 'Title IX Training',
    'CS 101 Project 2: Linked Lists': 'CS 101 Project 2: Linked Lists',
    'Assignment 3 - Recursion': 'Assignment 3: Recursion',
    'Chapter 12 Homework': 'Chapter 12 homework',
  };
  for (const [title, wanted] of Object.entries(titles)) assert.equal(planTitle(title), wanted, title);
});

test('a section code in the title or a class name is read, and a missing class says "your"', () => {
  assert.equal(plan('Lab report [BIO-101-002]', ''), 'Plan your Lab report');
  assert.equal(planTitle('Lab report [BIO-101-002]'), 'Lab report');
  assert.equal(plan('Packback #12', 'EH 101'), "Plan EH 101's Packback");
  assert.equal(plan('Packback #12', 'Introduction to Music'), "Plan Introduction to Music's Packback");
  assert.equal(plan('Quiz 3', 'S1-FA24'), 'Plan your Quiz 3');
  assert.equal(plan('Quiz 3', 'Fall 2024'), 'Plan your Quiz 3');
  assert.equal(plan('Quiz 3', 'Statistics for Nurses'), "Plan Statistics for Nurses' Quiz 3");
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

test('a two-word department is kept, and false departments are not read as one', () => {
  assert.equal(classShort('Spring 2025 ART HIST 210'), 'ART HIST 210');
  assert.equal(classShort('BUS LAW 3310'), 'BUS LAW 3310');
  assert.equal(classShort('Intro to CS 101'), 'CS 101');
  assert.equal(classShort('INTRO TO CS 101'), 'CS 101');
  assert.equal(classShort('Art History Survey II (ARTH-2202-01)'), 'ARTH 2202');
  assert.equal(classShort('ARTH2201'), 'ARTH 2201');
  assert.equal(classShort('BIOL 1010 Sec 02'), 'BIOL 1010');
  assert.equal(classShort('202510-CS-1301-A'), 'CS 1301');
  assert.equal(classShort('2024FA-ENG-101-01'), 'ENG 101');
  for (const course of ['Sec 02 Biology', 'Lab 02 - Chemistry', 'Week 5', 'COVID 19 Seminar', 'FA24', 'Fall 2024', 'Fall 2024 Cohort A', 'S1-FA24', 'CS']) {
    assert.doesNotMatch(classShort(course), /^(SEC|LAB|WEEK|COVID|FA|FALL|COHORT)\b|^CS$/i, course);
  }
  assert.equal(classShort('Week 5'), '');
  assert.equal(classShort('COVID 19 Seminar'), '');
});

test('a class named in words is cut at a dash, a bracket or Section, and loses its term', () => {
  assert.equal(classShort('Contracts I - Section 3'), 'Contracts I');
  assert.equal(classShort('SP25 Adult Health I'), 'Adult Health I');
  assert.equal(classShort('Nursing Fundamentals Fall 2024'), 'Nursing Fundamentals');
  assert.equal(classShort('Lab 02 - Chemistry'), 'Chemistry');
  assert.equal(classShort('Sec 02 Biology'), 'Biology');
  assert.equal(classShort('American Literature II'), 'American Literature II');
  assert.equal(classShort('Pathophysiology'), 'Pathophysiology');
  assert.equal(classShort('NURS 3310: Adult Health II'), 'NURS 3310');
  assert.equal(classShort('ENGL 1102 - Comp II'), 'ENGL 1102');
  assert.equal(classShort('Shakespeare (ENG 340)'), 'ENG 340');
  assert.equal(classShort('MGT 4400 Business Law & Ethics'), 'MGT 4400');
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

test('a course number from 1900 to 2099 is a level, unless a term or year word sits right before it', () => {
  assert.equal(classShort('ECE 2035'), 'ECE 2035');
  assert.equal(classShort('ARH 2051 Art History II'), 'ARH 2051');
  assert.equal(classShort('MATH 2024'), 'MATH 2024');
  assert.equal(classShort('Fall 2025 - ECE 2035'), 'ECE 2035');
  assert.equal(classShort('2025SP MATH-1314-002'), 'MATH 1314');
  for (const course of ['Fall 2025', 'Spring 2026', 'FY 2025', 'Class of 2025', 'Spring ECE 2035']) assert.equal(classShort(course), '', course);
  assert.equal(plan('Quiz 4', 'ECE 2035'), "Plan ECE 2035's Quiz 4");
});

test('a leading id goes: "HW 6:" with a space, "P4:" and "MP2 -", but "P53 Pathway Quiz" keeps its protein', () => {
  assert.equal(planTitle('HW 6: Dynamic Programming'), 'Dynamic Programming');
  assert.equal(planTitle('Q 2: Limits'), 'Limits');
  assert.equal(planTitle('P4: Malloc Lab'), 'Malloc lab');
  assert.equal(planTitle('MP2 - Linked Lists'), 'Linked Lists');
  assert.equal(planTitle('P53 Pathway Quiz'), 'P53 Pathway quiz');
  assert.equal(planTitle('Lab 5: Binary Search Trees'), 'Lab 5: Binary Search Trees', 'Lab is not an id word');
  assert.equal(planTitle('HW 6'), 'HW 6', 'nothing after it: kept');
  assert.equal(planTitle('Q 2 Limits'), 'Q 2 Limits', 'no colon: kept');
});
