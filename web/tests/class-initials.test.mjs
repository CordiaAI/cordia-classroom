// The two letters on a class's dot in the folded sidebar (VISUAL-POLISH V1.1, lib/classInitials.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classInitials } from '../lib/classInitials.mjs';
import { classLabel } from '../lib/classLabel.js';

// What components/Sidebar.js passes: classLabel's code ('' when none) and its title.
const fromName = name => { const { title, code } = classLabel(name); return classInitials(code, title || name); };

test('a course code gives its first two letters', () => {
  assert.equal(classInitials('EH 102', 'English Composition II'), 'EH');
  assert.equal(classInitials('MA 125', 'Calculus I'), 'MA');
  assert.equal(classInitials('NUR210', 'Adult Health'), 'NU');
  assert.equal(classInitials('ART HIST 210', 'Art History'), 'AR');
  assert.equal(fromName('MUL 101 MUL-101-102: Introduction to Music'), 'MU');
  assert.equal(fromName('EH 102: English Composition II'), 'EH');
});

test('a class named by its code counts that as its code, terms and sections aside', () => {
  assert.equal(fromName('MA 125'), 'MA');
  assert.equal(fromName('EH-102-136'), 'EH');
  assert.equal(fromName('bio 101'), 'BI');
  assert.equal(fromName('ECE 2035'), 'EC');
});

test('a class without a course code takes the first letters of the first two words of its name', () => {
  assert.equal(fromName('Adult Health I'), 'AH');
  assert.equal(fromName('Introduction to Music'), 'IM');
  assert.equal(fromName('The Art of Rhetoric'), 'AR');
  assert.equal(fromName('SP25 Adult Health I'), 'AH');
  assert.equal(fromName('Business Law & Ethics'), 'BL');
  assert.equal(fromName('Écologie générale'), 'EG');
});

test('one word gives its first two letters; numbers and empty names give no stray digits', () => {
  assert.equal(fromName('Biology'), 'BI');
  assert.equal(fromName('Biology 101'), 'BI');
  assert.equal(fromName('Chemistry 2'), 'CH');
  assert.equal(fromName('Class'), 'CL');
  assert.equal(classInitials('', ''), '');
  assert.equal(classInitials(null, undefined), '');
  for (const name of ['Week 5', 'Fall 2025 Biology', '2025 Cohort', 'Lab 3']) assert.match(fromName(name), /^\p{Lu}{1,2}$/u, name);
});
