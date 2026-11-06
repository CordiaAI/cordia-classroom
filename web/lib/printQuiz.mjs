// Printable quiz: the student's chosen format turned into a laid-out test from the guide's item
// pools (POST /quiz/{id}/print-items). Pure, so the sheet, the print page and the tests share it.
//
// Pools: mc [{ id, source, question, options, answer }], matching [{ id, source, term, definition }],
// fill [{ id, source, parts, blanks, points }], short [{ id, source, question, key, points }].
// `source` is the guide question an item came from: one printout never asks an idea twice.

import { shuffled } from './retainEngine.mjs';

export const TYPES = ['mc', 'matching', 'fill', 'short'];
export const TYPE_NAMES = { mc: 'Multiple choice', matching: 'Matching', fill: 'Fill in the blank', short: 'Short answer' };
const SINGULAR = { mc: 'multiple-choice question', matching: 'matching term', fill: 'fill-in-the-blank question', short: 'short-answer question' };
const PLURAL = { mc: 'multiple-choice questions', matching: 'matching terms', fill: 'fill-in-the-blank questions', short: 'short-answer questions' };
export const MATCH_BLOCK = 8;
export const SHORT_POINTS = 4;
export const MAX_COUNT = 50;
// Scarce types claim their ideas first; multiple choice can ask almost anything.
const CLAIM_ORDER = ['short', 'matching', 'fill', 'mc'];

export const PRESETS = [
  { key: 'mixed', label: 'Mixed', counts: { mc: 8, matching: 8, fill: 6, short: 3 } },
  { key: 'mc', label: 'All multiple choice', counts: { mc: 12, matching: 0, fill: 0, short: 0 } },
  { key: 'short', label: 'All short answer', counts: { mc: 0, matching: 0, fill: 0, short: 9 } },
  { key: 'fill', label: 'All fill in the blank', counts: { mc: 0, matching: 0, fill: 12, short: 0 } },
  { key: 'matching', label: 'All matching', counts: { mc: 0, matching: 16, fill: 0, short: 0 } },
];

export const DEFAULT_FORMAT = {
  counts: { ...PRESETS[0].counts },
  on: { mc: true, matching: true, fill: true, short: true },
  shuffleQuestions: false,
  shuffleOptions: false,
  answerKey: true,
  versions: false,
};

// A preset sets the toggles and the counts; the student can change either afterwards.
export function applyPreset(format, key) {
  const preset = PRESETS.find(item => item.key === key) || PRESETS[0];
  const on = Object.fromEntries(TYPES.map(type => [type, preset.counts[type] > 0]));
  return { ...format, counts: { ...format.counts, ...Object.fromEntries(TYPES.map(type => [type, preset.counts[type] || format.counts[type] || 0])) }, on };
}

// The preset the format still matches exactly, or null once it's been changed.
export function matchingPreset(format) {
  return PRESETS.find(preset => TYPES.every(type => (preset.counts[type] > 0) === Boolean(format.on[type])
    && (!format.on[type] || preset.counts[type] === format.counts[type])))?.key || null;
}

// A saved or linked format, made safe: known keys only, counts 0-50, at least one type on.
export function cleanFormat(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const counts = Object.fromEntries(TYPES.map(type => {
    const count = Math.round(Number(raw.counts?.[type]));
    return [type, Number.isFinite(count) ? Math.max(0, Math.min(MAX_COUNT, count)) : DEFAULT_FORMAT.counts[type]];
  }));
  const on = Object.fromEntries(TYPES.map(type => [type, raw.on ? Boolean(raw.on[type]) && counts[type] > 0 : DEFAULT_FORMAT.on[type]]));
  const format = {
    counts,
    on: TYPES.some(type => on[type]) ? on : { ...DEFAULT_FORMAT.on },
    shuffleQuestions: Boolean(raw.shuffleQuestions),
    shuffleOptions: Boolean(raw.shuffleOptions),
    answerKey: raw.answerKey === undefined ? true : Boolean(raw.answerKey),
    versions: Boolean(raw.versions),
  };
  if (!TYPES.some(type => format.on[type])) format.on = { ...DEFAULT_FORMAT.on };
  return format;
}

// Turning a type on or off; the last type on stays on.
export function toggleType(format, type, value) {
  const on = { ...format.on, [type]: value };
  if (!TYPES.some(key => on[key])) return format;
  const counts = { ...format.counts };
  if (value && !counts[type]) counts[type] = PRESETS[0].counts[type];
  return { ...format, on, counts };
}

export function setCount(format, type, count) {
  const value = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(count) || 0)));
  return { ...format, counts: { ...format.counts, [type]: value } };
}

// Even blocks of at most 8 terms: 16 -> 8 + 8, 17 -> 6 + 6 + 5.
export function matchingBlocks(count) {
  if (count <= 0) return [];
  const blocks = Math.ceil(count / MATCH_BLOCK);
  const base = Math.floor(count / blocks);
  return Array.from({ length: blocks }, (_, i) => base + (i < count % blocks ? 1 : 0));
}

// Picks the items for each chosen type without asking any idea twice. Returns
// { picked: { type: items }, extras: [definitions not used], capped: { type: available } }.
export function allocate(pools, format) {
  const used = new Set();
  const picked = Object.fromEntries(TYPES.map(type => [type, []]));
  const capped = {};
  let extras = [];
  const free = type => (pools[type] || []).filter(item => !used.has(String(item.source)));
  CLAIM_ORDER.forEach(type => {
    if (!format.on[type]) return;
    const wanted = format.counts[type];
    const pool = free(type);
    if (type === 'matching') {
      // Each block of terms has one extra definition, so n terms in b blocks need n + b ideas.
      let count = Math.min(wanted, pool.length);
      while (count > 0 && count + matchingBlocks(count).length > pool.length) count -= 1;
      picked.matching = pool.slice(0, count);
      extras = pool.slice(count, count + matchingBlocks(count).length);
      [...picked.matching, ...extras].forEach(item => used.add(String(item.source)));
      if (count < wanted) capped.matching = count;
      return;
    }
    picked[type] = pool.slice(0, wanted);
    picked[type].forEach(item => used.add(String(item.source)));
    if (picked[type].length < wanted) capped[type] = picked[type].length;
  });
  return { picked, extras, capped };
}

export function pointsFor(type, item) {
  if (type === 'fill') return item.points || item.blanks?.length || 1;
  if (type === 'short') return item.points || SHORT_POINTS;
  return 1;
}

// "This guide has enough for 9 short-answer questions." for each type it couldn't fill.
export function capNotes(capped) {
  return TYPES.filter(type => type in capped).map(type => {
    const count = capped[type];
    if (!count) return `This guide doesn't have material for ${PLURAL[type]}.`;
    return `This guide has enough for ${count} ${count === 1 ? SINGULAR[type] : PLURAL[type]}.`;
  });
}

const DIRECTIONS = {
  mc: 'Fill in the circle next to the best answer.',
  fill: 'Write the missing word or words on each line.',
  short: 'Answer in two to four complete sentences.',
};
const POINTS_NOTE = { mc: '1 pt each', matching: '1 pt each', fill: '1 pt per blank', short: `${SHORT_POINTS} pts each` };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function seeded(items, seed, on) {
  return on ? shuffled(items, seed) : items;
}

// One version of the test: sections in print order, numbered straight through, and its key.
function layoutVersion(allocation, format, seed, shuffle) {
  const chosen = TYPES.filter(type => allocation.picked[type].length);
  const mixed = chosen.length > 1;
  let number = 1;
  const sections = [];
  const key = [];
  chosen.forEach((type, index) => {
    const part = mixed ? LETTERS[index] : null;
    const items = seeded(allocation.picked[type], seed + index * 101, shuffle.questions);
    const points = items.reduce((sum, item) => sum + pointsFor(type, item), 0);
    const section = { type, part, title: TYPE_NAMES[type], pointsNote: POINTS_NOTE[type], points, start: number };
    if (type === 'mc') {
      section.items = items.map((item, i) => {
        const order = seeded(item.options.map((_, k) => k), seed + 7 * (i + 1), shuffle.options);
        return { number: number + i, id: item.id, question: item.question, options: order.map(k => item.options[k]), answer: order.indexOf(item.answer) };
      });
      key.push({ type, part, entries: section.items.map(item => ({ number: item.number, answer: LETTERS[item.answer] })) });
    } else if (type === 'matching') {
      const sizes = matchingBlocks(items.length);
      let offset = 0;
      section.blocks = sizes.map((size, b) => {
        const terms = items.slice(offset, offset + size);
        offset += size;
        const extra = allocation.extras[b];
        const definitions = shuffled([...terms, ...(extra ? [extra] : [])], seed + 13 * (b + 1));
        return {
          terms: terms.map((item, i) => ({ number: number + sizes.slice(0, b).reduce((a, c) => a + c, 0) + i, id: item.id, term: item.term, letter: LETTERS[definitions.indexOf(item)] })),
          definitions: definitions.map((item, d) => ({ letter: LETTERS[d], definition: item.definition })),
          extra: Boolean(extra),
        };
      });
      section.directions = 'Write the letter of the matching definition on the line.'
        + (section.blocks.every(block => block.extra) ? (section.blocks.length > 1 ? ' Each set has one definition that is not used.' : ' One definition is not used.') : '');
      key.push({ type, part, entries: section.blocks.flatMap(block => block.terms.map(term => ({ number: term.number, answer: term.letter }))) });
    } else if (type === 'fill') {
      section.items = items.map((item, i) => ({ number: number + i, id: item.id, parts: item.parts, blanks: item.blanks }));
      key.push({ type, part, entries: section.items.map(item => ({ number: item.number, answer: item.blanks.join(' · ') })) });
    } else {
      section.items = items.map((item, i) => ({ number: number + i, id: item.id, question: item.question }));
      key.push({ type, part, entries: section.items.map((item, i) => ({ number: item.number, answer: items[i].key })) });
    }
    section.directions = section.directions || DIRECTIONS[type];
    number += items.length;
    sections.push(section);
  });
  return { sections, key };
}

// The whole printout: one or two versions, the header tag, part cards and instructions.
export function buildPrint(pools, format, seed = 1) {
  const clean = cleanFormat(format);
  const allocation = allocate(pools, clean);
  const chosen = TYPES.filter(type => allocation.picked[type].length);
  const mixed = chosen.length > 1;
  const questions = chosen.reduce((sum, type) => sum + allocation.picked[type].length, 0);
  const points = chosen.reduce((sum, type) => sum + allocation.picked[type].reduce((total, item) => total + pointsFor(type, item), 0), 0);
  const tag = `${mixed ? 'Mixed format' : TYPE_NAMES[chosen[0]] || 'Quiz'} · ${questions} ${questions === 1 ? 'question' : 'questions'} · ${points} ${points === 1 ? 'point' : 'points'}`.toUpperCase();
  const versions = (clean.versions ? ['A', 'B'] : [null]).map((label, v) => ({
    label,
    // Two versions are always shuffled, each its own way; one version follows the toggles.
    ...layoutVersion(allocation, clean, seed + v * 7919, { questions: clean.versions || clean.shuffleQuestions, options: clean.versions || clean.shuffleOptions }),
  }));
  const parts = mixed ? versions[0].sections.map(section => ({ part: section.part, name: section.title, points: section.points })) : [];
  const instructions = 'Read each direction before you start. Write clearly in pen or pencil.' + (chosen.includes('fill') ? ' Each blank is worth one point.' : '');
  return {
    versions,
    questions,
    points,
    tag,
    mixed,
    parts,
    instructions,
    answerKey: clean.answerKey,
    shortLines: chosen.length === 1 && chosen[0] === 'short' ? 6 : 5,
    notes: capNotes(allocation.capped),
    capped: allocation.capped,
  };
}

// The format in a print link (?f=...), and back.
export function encodeFormat(format) {
  const clean = cleanFormat(format);
  const counts = TYPES.map(type => (clean.on[type] ? clean.counts[type] : 0)).join('.');
  const flags = ['shuffleQuestions', 'shuffleOptions', 'answerKey', 'versions'].map(flag => (clean[flag] ? 1 : 0)).join('');
  return `${counts}-${flags}`;
}

export function decodeFormat(text) {
  const [counts = '', flags = ''] = String(text || '').split('-');
  const values = counts.split('.').map(Number);
  if (values.length !== TYPES.length || values.some(value => !Number.isFinite(value))) return cleanFormat(null);
  return cleanFormat({
    counts: Object.fromEntries(TYPES.map((type, i) => [type, values[i] || DEFAULT_FORMAT.counts[type]])),
    on: Object.fromEntries(TYPES.map((type, i) => [type, values[i] > 0])),
    shuffleQuestions: flags[0] === '1',
    shuffleOptions: flags[1] === '1',
    answerKey: flags[2] !== '0',
    versions: flags[3] === '1',
  });
}
