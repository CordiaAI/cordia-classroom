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
const MAX_REASKS = 8;
const TERM_MAX_WORDS = 5;

export function conceptAnswer(question) {
  const options = question?.options || [];
  const index = question?.correct_index;
  return Number.isInteger(index) && index >= 0 && index < options.length ? String(options[index]) : '';
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

export function createSession(questions, cards, selected) {
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
  };
}

export function currentCard(session) {
  return session.queue[session.position] || null;
}

// results: [{ concept, credit, response, token? }] for the card just answered.
export function recordResults(session, card, results) {
  const concepts = { ...session.concepts };
  const queue = [...session.queue];
  let nextId = session.nextId;
  results.forEach(result => {
    const state = { ...concepts[result.concept] };
    const right = result.credit === 1;
    if (!state.first) {
      state.first = { concept: result.concept, type: card.type, response: result.response ?? '', credit: result.credit, token: result.token || null };
      if (right) state.cleared = true;
      else { state.missed = true; state.needs = CLEAR_AFTER; }
    } else if (!state.cleared) {
      state.needs = right ? state.needs - 1 : CLEAR_AFTER;
      if (state.needs <= 0) state.cleared = true;
    }
    if (!state.cleared && state.reasks >= MAX_REASKS) { state.cleared = true; state.gaveUp = true; } // never trap a student in a loop
    if (!state.cleared) {
      const type = reaskType(session.questions[result.concept], state.firstType, state.reasks, session.selected);
      state.reasks += 1;
      const at = Math.min(queue.length, session.position + 1 + SPACING);
      queue.splice(at, 0, { type, concepts: [result.concept], id: nextId++, reask: true });
    }
    concepts[result.concept] = state;
  });
  return { ...session, concepts, queue, nextId };
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
