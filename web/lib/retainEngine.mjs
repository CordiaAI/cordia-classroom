// Retain session engine: answer checks that mirror backend/services/retain.py, and the
// mastery queue. Every idea is asked once; a miss means it must be answered right two more
// times, spaced a few questions apart, before it clears. The score is first-try credit only.

export const TYPE_LABELS = {
  mc: 'Multiple choice',
  written: 'Written',
  fill: 'Fill in the blank',
  matching: 'Matching',
};
export const PRO_TYPES = ['fill', 'matching'];
export const CLEAR_AFTER = 2;
export const SPACING = 3;
// LEARN_LADDER_V2: a miss comes back 6 to 10 questions later (6, then 8, then 10), or at the end
// when fewer remain. Longer gaps make the retry a real recall rather than a repeat from memory.
export const LADDER_SPACING = 6;
const LADDER_SPACING_MAX = 10;
const MAX_REASKS = 8;
const TERM_MAX_WORDS = 5;

export function conceptAnswer(question) {
  const options = question?.options || [];
  const index = question?.correct_index;
  return Number.isInteger(index) && index >= 0 && index < options.length ? String(options[index]) : '';
}

// One choice as shown: without a lone closing period, so the guide's own answer (a sentence ending
// in ".") doesn't stand out among wrong choices written without one. Abbreviations ("etc.", "U.S.")
// and ellipses keep theirs. Mirrors backend/routers/quiz.py choice_text.
const KEEP_PERIOD = new Set(['etc', 'vs', 'inc', 'jr', 'sr', 'dr', 'st', 'mr', 'mrs', 'ms', 'no', 'approx', 'co', 'ltd', 'al']);
export function choiceText(text) {
  const value = String(text ?? '').trim();
  if (!value.endsWith('.') || value.endsWith('..')) return value;
  const last = value.slice(0, -1).split(/\s+/).pop() || '';
  if (last.includes('.') || KEEP_PERIOD.has(last.toLowerCase())) return value;
  return value.slice(0, -1).trimEnd();
}

export function normalize(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['\u2019]|(?<!\d)\.|\.(?!\d)/g, '') // U.S. = US, Newton's = Newtons
    .replace(/[^a-z0-9.%+\- ]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an)\s+/, '');
}

function acceptedAnswers(answer) {
  const raw = String(answer || '');
  const parts = new Set([raw, raw.replace(/\([^)]*\)/g, '')]);
  for (const match of raw.matchAll(/\(([^)]*)\)/g)) parts.add(match[1]);
  for (const separator of [/\s+or\s+/, /\s*\/\s*/, /\s*;\s*/]) raw.split(separator).forEach(part => parts.add(part));
  const values = new Set([...parts].map(normalize).filter(Boolean));
  for (const value of [...values]) if (value.endsWith('s') && value.length > 3) values.add(value.slice(0, -1));
  return values;
}

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    previous = current;
  }
  return previous[b.length];
}

// Case, articles, plurals and small typos are fine; numbers must be exact.
export function fillMatches(response, answer) {
  const given = normalize(response);
  if (!given) return false;
  const candidates = new Set([given]);
  if (given.endsWith('s') && given.length > 3) candidates.add(given.slice(0, -1));
  for (const accepted of acceptedAnswers(answer)) {
    for (const value of candidates) {
      if (value === accepted) return true;
      if (!/\d/.test(accepted) && accepted.length >= 5 && distance(value, accepted) <= Math.floor(accepted.length / 6)) return true;
    }
  }
  return false;
}

// Words that carry no meaning on their own, left out when comparing typed answers word by word.
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were', 'by', 'with', 'its', 'it']);
const keyWords = text => String(text || '').split(' ').filter(word => word && !FILLER.has(word));
function sameWord(a, b) {
  if (a === b) return true;
  if (a.replace(/s$/, '') === b.replace(/s$/, '')) return true;
  return a.length >= 5 && b.length >= 5 && !/\d/.test(a + b) && distance(a, b) <= Math.floor(Math.max(a.length, b.length) / 5);
}

// A typed answer: 'right' (fillMatches), 'close' (part of the answer, nothing that contradicts it:
// "Alpha Sigma" for "Oregon Alpha Sigma") or 'wrong'. Close = every number in the answer is there,
// the typed words cover at least half of the answer's key words, and at most one typed word isn't
// in the answer. The student decides whether a close answer counts. Mirrors backend fill_verdict.
export function fillVerdict(response, answer) {
  if (fillMatches(response, answer)) return 'right';
  const given = keyWords(normalize(response));
  if (!given.length) return 'wrong';
  for (const accepted of acceptedAnswers(answer)) {
    const target = keyWords(accepted);
    if (!target.length) continue;
    if (target.some(word => /\d/.test(word) && !given.includes(word))) continue;
    const covered = target.filter(word => given.some(typed => sameWord(typed, word))).length;
    const extra = given.filter(typed => !target.some(word => sameWord(typed, word))).length;
    if (covered > 0 && covered * 2 >= target.length && extra <= 1) return 'close';
  }
  return 'wrong';
}

function isTerm(question) {
  return conceptAnswer(question).split(/\s+/).filter(Boolean).length <= TERM_MAX_WORDS;
}

// A missed idea comes back in a slightly different form so position can't be memorised:
// terms alternate fill in the blank / multiple choice, written answers alternate with
// multiple choice (fewer AI checks), everything else is multiple choice with new option order.
export function reaskType(question, firstType, reaskNumber, selected) {
  const allowed = new Set(['mc', ...(selected || [])]);
  let cycle = ['mc'];
  if (firstType === 'written') cycle = ['mc', 'written'];
  else if (isTerm(question)) cycle = ['fill', 'mc'];
  cycle = cycle.filter(type => allowed.has(type));
  return cycle[reaskNumber % cycle.length] || 'mc';
}

export function createSession(questions, cards, selected, { ladder = false } = {}) {
  let nextId = 0;
  const concepts = {};
  cards.forEach(card => card.concepts.forEach(index => {
    concepts[index] = { firstType: card.type, first: null, needs: 0, reasks: 0, missed: false, cleared: false };
  }));
  return {
    questions,
    selected: selected || [],
    queue: cards.map(card => ({ ...card, id: nextId++, reask: false })),
    position: 0,
    nextId,
    concepts,
    ladder: Boolean(ladder),
    lastAsked: {},
  };
}

// How many questions came between this idea's last ask and now (null the first time).
export function sinceLastAsked(session, concept) {
  const last = session.lastAsked?.[concept];
  return last === undefined ? null : session.position - last - 1;
}

function reaskGap(session, reasks) {
  if (!session.ladder) return SPACING;
  return Math.min(LADDER_SPACING_MAX, LADDER_SPACING + 2 * reasks);
}

export function currentCard(session) {
  return session.queue[session.position] || null;
}

// results: [{ concept, credit, response, token? }] for the card just answered.
export function recordResults(session, card, results) {
  const concepts = { ...session.concepts };
  const lastAsked = { ...(session.lastAsked || {}) };
  const queue = [...session.queue];
  let nextId = session.nextId;
  results.forEach(result => {
    const state = { ...concepts[result.concept] };
    const right = result.credit === 1;
    if (!state.first) {
      state.first = { concept: result.concept, type: card.type, response: result.response ?? '', credit: result.credit, token: result.token || null, ...(result.confidence ? { confidence: result.confidence } : {}), ...(result.selfMarked ? { self_marked: true } : {}) };
      if (right) state.cleared = true;
      else { state.missed = true; state.needs = CLEAR_AFTER; }
    } else if (!state.cleared) {
      state.needs = right ? state.needs - 1 : CLEAR_AFTER;
      if (state.needs <= 0) state.cleared = true;
    }
    if (!state.cleared && state.reasks >= MAX_REASKS) { state.cleared = true; state.gaveUp = true; } // never trap a student in a loop
    if (!state.cleared) {
      const type = reaskType(session.questions[result.concept], state.firstType, state.reasks, session.selected);
      const at = Math.min(queue.length, session.position + 1 + reaskGap(session, state.reasks));
      state.reasks += 1;
      queue.splice(at, 0, { type, concepts: [result.concept], id: nextId++, reask: true });
    }
    concepts[result.concept] = state;
    lastAsked[result.concept] = session.position;
  });
  return { ...session, concepts, queue, nextId, lastAsked };
}

export function advance(session) {
  return { ...session, position: session.position + 1 };
}

export function progress(session) {
  const states = Object.values(session.concepts);
  return {
    total: states.length,
    cleared: states.filter(state => state.cleared).length,
    toClear: states.filter(state => state.first && !state.cleared).length,
    missedMastered: states.filter(state => state.missed && state.cleared && !state.gaveUp).length,
    firstTryRight: states.filter(state => state.first?.credit === 1).length,
    done: session.position >= session.queue.length,
  };
}

export function firstAttempts(session) {
  return Object.values(session.concepts).map(state => state.first).filter(Boolean);
}

export function shuffled(values, seed) {
  const items = [...values];
  let state = seed + 1;
  for (let i = items.length - 1; i > 0; i -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const j = Math.floor((state / 233280) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
