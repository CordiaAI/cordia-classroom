import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORMAT, PRESETS, allocate, applyPreset, buildPrint, cleanFormat, decodeFormat, encodeFormat, matchingBlocks, matchingPreset, toggleType,
} from '../lib/printQuiz.mjs';

const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);
// Distinct ideas per type, like a 60-question guide: 20 MC, 14 matching, 17 fill-in, 10 short answer.
// The first six fill-ins hold 8 blanks, as in the approved Mixed sample (36 points).
const POOLS = {
  mc: range(0, 20).map(i => ({ id: `mc${i}`, source: i, question: `Question ${i}?`, options: ['W', 'X', 'Y', 'Z'], answer: i % 4 })),
  matching: range(20, 14).map(i => ({ id: `m${i}`, source: i, term: `Term ${i}`, definition: `Definition ${i}` })),
  fill: range(34, 17).map((i, n) => ({ id: `f${i}`, source: i, parts: ['Before ', { blank: 'word' }, '.'], blanks: n === 0 || n === 3 ? ['one', 'two'] : ['one'], points: n === 0 || n === 3 ? 2 : 1 })),
  short: range(51, 10).map(i => ({ id: `s${i}`, source: i, question: `Why ${i}?`, key: `Because ${i}.`, points: 4 })),
};
const formatFor = key => applyPreset(DEFAULT_FORMAT, key);

test('point totals and question counts for each preset', () => {
  const totals = Object.fromEntries(PRESETS.map(preset => {
    const print = buildPrint(POOLS, formatFor(preset.key));
    return [preset.key, [print.questions, print.points]];
  }));
  assert.deepEqual(totals.mixed, [25, 36]);
  assert.deepEqual(totals.mc, [12, 12]);
  assert.deepEqual(totals.short, [9, 36]);
  assert.deepEqual(totals.fill, [12, 14]);
  assert.deepEqual(totals.matching, [12, 12]); // capped: 14 ideas hold 12 terms in 2 blocks plus 2 spare definitions
});

test('the header tag and parts follow the selection', () => {
  const mixed = buildPrint(POOLS, formatFor('mixed'));
  assert.equal(mixed.tag, 'MIXED FORMAT · 25 QUESTIONS · 36 POINTS');
  assert.deepEqual(mixed.parts.map(part => `${part.part} ${part.name} ${part.points}`), ['A Multiple choice 8', 'B Matching 8', 'C Fill in the blank 8', 'D Short answer 12']);
  assert.equal(mixed.instructions, 'Read each direction before you start. Write clearly in pen or pencil. Each blank is worth one point.');
  assert.equal(mixed.shortLines, 5);
  const short = buildPrint(POOLS, formatFor('short'));
  assert.equal(short.tag, 'SHORT ANSWER · 9 QUESTIONS · 36 POINTS');
  assert.deepEqual(short.parts, []);
  assert.equal(short.versions[0].sections[0].part, null);
  assert.equal(short.instructions, 'Read each direction before you start. Write clearly in pen or pencil.');
  assert.equal(short.shortLines, 6);
});

test('counts are capped to the material and the note says so plainly', () => {
  const format = { ...formatFor('short'), counts: { ...formatFor('short').counts, short: 15 } };
  const print = buildPrint(POOLS, format);
  assert.equal(print.questions, 10);
  assert.deepEqual(print.notes, ['This guide has enough for 10 short-answer questions.']);
  assert.deepEqual(buildPrint(POOLS, formatFor('matching')).notes, ['This guide has enough for 12 matching terms.']);
  const none = buildPrint({ ...POOLS, fill: [] }, formatFor('mixed'));
  assert.ok(none.notes.includes("This guide doesn't have material for fill-in-the-blank questions."));
  assert.equal(none.parts.length, 3);
});

test('never repeats an idea across types and never pads with repeats', () => {
  // Every type drawn from the same six ideas.
  const shared = {
    mc: range(0, 6).map(i => ({ ...POOLS.mc[i], source: i })),
    matching: range(0, 6).map(i => ({ ...POOLS.matching[i], source: i })),
    fill: [], short: range(0, 6).map(i => ({ ...POOLS.short[i], source: i })),
  };
  const { picked, extras } = allocate(shared, { ...formatFor('mixed'), counts: { mc: 6, matching: 2, fill: 0, short: 2 } });
  const sources = [...picked.short, ...picked.matching, ...extras, ...picked.mc].map(item => item.source);
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(picked.short.length, 2);
  assert.equal(picked.matching.length, 2);
  assert.equal(extras.length, 1);
  assert.equal(picked.mc.length, 1);
});

test('matching blocks of eight with one unused definition each', () => {
  assert.deepEqual(matchingBlocks(8), [8]);
  assert.deepEqual(matchingBlocks(16), [8, 8]);
  assert.deepEqual(matchingBlocks(17), [6, 6, 5]);
  const print = buildPrint(POOLS, formatFor('mixed'));
  const matching = print.versions[0].sections.find(section => section.type === 'matching');
  assert.equal(matching.blocks.length, 1);
  assert.equal(matching.blocks[0].terms.length, 8);
  assert.equal(matching.blocks[0].definitions.length, 9);
  assert.equal(matching.directions, 'Write the letter of the matching definition on the line. One definition is not used.');
  const key = print.versions[0].key.find(entry => entry.type === 'matching');
  matching.blocks[0].terms.forEach((term, i) => {
    const definition = matching.blocks[0].definitions.find(item => item.letter === key.entries[i].answer).definition;
    assert.equal(definition, term.term.replace('Term', 'Definition'));
  });
});

test('numbering runs straight through the parts and versions differ with their own keys', () => {
  const print = buildPrint(POOLS, { ...formatFor('mixed'), versions: true });
  assert.deepEqual(print.versions.map(version => version.label), ['A', 'B']);
  assert.deepEqual(print.versions[0].sections.map(section => section.start), [1, 9, 17, 23]);
  const [a, b] = print.versions.map(version => version.sections[0].items.map(item => item.id).join());
  assert.notEqual(a, b);
  print.versions.forEach(version => {
    const mc = version.sections[0];
    const key = version.key[0];
    mc.items.forEach((item, i) => {
      const original = POOLS.mc.find(pool => pool.id === item.id);
      assert.equal(item.options['ABCD'.indexOf(key.entries[i].answer)], original.options[original.answer]);
    });
  });
});

test('presets set toggles and counts, edits are kept, and at least one type stays on', () => {
  const mc = formatFor('mc');
  assert.deepEqual(mc.on, { mc: true, matching: false, fill: false, short: false });
  assert.equal(matchingPreset(mc), 'mc');
  const edited = toggleType(mc, 'short', true);
  assert.equal(matchingPreset(edited), null);
  assert.equal(toggleType(mc, 'mc', false), mc);
  assert.deepEqual(cleanFormat({ on: { mc: false, matching: false, fill: false, short: false }, counts: {} }).on, DEFAULT_FORMAT.on);
});

test('a format survives the print link', () => {
  const format = { ...formatFor('mixed'), counts: { mc: 10, matching: 8, fill: 4, short: 2 }, shuffleOptions: true, answerKey: false, versions: true };
  const back = decodeFormat(encodeFormat(format));
  assert.deepEqual(back.counts, format.counts);
  assert.deepEqual(back.on, format.on);
  assert.equal(back.shuffleOptions, true);
  assert.equal(back.answerKey, false);
  assert.equal(back.versions, true);
  assert.deepEqual(decodeFormat('garbage').on, DEFAULT_FORMAT.on);
});
