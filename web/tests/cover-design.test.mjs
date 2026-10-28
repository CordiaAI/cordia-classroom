// Class covers: a colour and subject icons from a fixed list, never text or outside images.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COVER_ICONS, cleanIcons, colorFor, coverFor, keywordIcons } from '../lib/coverDesign.mjs';

test('keywords give each kind of class fitting icons across disciplines', () => {
  assert.deepEqual(keywordIcons('Music 101 : Intro to Music'), ['Music', 'Piano', 'Headphones']);
  assert.deepEqual(keywordIcons('English 102 : English Composition II'), ['BookOpen', 'Feather', 'PenLine']);
  assert.deepEqual(keywordIcons('NURS 230 Pharmacology'), ['Stethoscope', 'HeartPulse', 'Pill']);
  assert.deepEqual(keywordIcons('Religion 200 : Old Testament Theology'), ['Church', 'Scroll', 'BookOpen']);
  assert.deepEqual(keywordIcons('HIST 210'), ['BookOpen', 'Lightbulb', 'GraduationCap'], 'an unknown name still gets a cover');
  assert.ok(keywordIcons('ABC 1', ['Glycolysis and the Krebs cycle in the cell']).includes('Dna'), 'the material counts too');
  for (const name of ['Music 101', 'BUS 150', 'ART 220']) assert.ok(keywordIcons(name).every(icon => COVER_ICONS.includes(icon)));
});

test('a saved design wins; anything else is drawn from the name', () => {
  assert.equal(colorFor('Music 101'), colorFor('Music 101'));
  assert.ok(colorFor('Music 101') >= 0 && colorFor('Music 101') < 8);
  assert.deepEqual(coverFor({ name: 'Music 101', cover: { kind: 'design', color: 2, icons: ['Guitar', 'Nope'] } }), { color: 2, icons: ['Guitar'], saved: true });
  const legacy = coverFor({ name: 'Music 101', cover: { url: 'https://example.com/x.svg' } });
  assert.equal(legacy.saved, false, 'an old Napkin cover is replaced by a designed one');
  assert.deepEqual(cleanIcons(['Music', 'Music', 'script', 'Piano', 'Atom', 'Sun']), ['Music', 'Piano', 'Atom']);
});
