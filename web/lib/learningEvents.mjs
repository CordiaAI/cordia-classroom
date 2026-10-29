// Honest logging (adaptive engine phase 1): what a student answered, how, and how long it took.
// Pure parts: the names the server stores, the per-answer timer and the send queue. The browser
// side (lib/learningEvents.js) wires them to fetch, storage and the page.
//
// Events and decisions go to POST /learning-events in batches. Studying never waits on it: sends
// happen in the background, a failed send is retried a few times from a small saved queue, and a
// refused or switched-off batch is dropped.

import { fingerprint } from './learnEngine.mjs';

export const MAX_BATCH = 50;
export const MAX_QUEUED = 200;
export const MAX_TRIES = 5;

// Card types in the app -> learning_events.format.
const FORMATS = { mc: 'choice', fill: 'typed', written: 'written', self: 'flashcard', flashcard: 'flashcard', matching: 'pairs', pairs: 'pairs', practice: 'practice' };

export function formatFor(type) {
  return FORMATS[type] || null;
}

// credit 1 right, 0.5 partly right, else wrong; a flashcard is Got it or Again.
export function outcomeFor(credit, format) {
  if (format === 'flashcard') return credit === 1 ? 'got_it' : 'again';
  if (credit === 1) return 'right';
  if (credit === 0.5) return 'partly';
  return 'wrong';
}

const CONFIDENCE = { sure: 'sure', think: 'think_so', think_so: 'think_so', guess: 'guess' };

export function confidenceFor(level) {
  return CONFIDENCE[level] || null;
}

export function itemFingerprint(text) {
  return fingerprint({ question: text });
}

// One answer's timing: from when the question showed to the first keypress and to the answer,
// plus how long the tab was hidden meanwhile. now() is a millisecond clock.
export function answerTimer(now, hiddenAtStart = false) {
  const shown = now();
  let firstKey = null;
  let hiddenSince = hiddenAtStart ? shown : null;
  let hidden = 0;
  let result = null;
  return {
    key() { if (firstKey === null && result === null) firstKey = now() - shown; },
    visibility(isHidden) {
      if (result) return;
      const at = now();
      if (isHidden && hiddenSince === null) hiddenSince = at;
      if (!isHidden && hiddenSince !== null) { hidden += at - hiddenSince; hiddenSince = null; }
    },
    // Freezes on the first call: the answer is the first commitment, not a later re-check.
    done() {
      if (!result) {
        const at = now();
        const stillHidden = hiddenSince !== null ? at - hiddenSince : 0;
        result = { first_key_ms: firstKey, submit_ms: Math.max(0, Math.round(at - shown)), hidden_ms: Math.round(hidden + stillHidden) };
      }
      return result;
    },
  };
}

// The send queue. send(body) resolves to { status, data } (status 0 when the network failed).
// load/save keep pending items across a reload; both may be no-ops.
export function createQueue({ send, load = () => [], save = () => {}, tzOffset = () => 0 }) {
  let items = [];
  try { items = (load() || []).filter(item => item && (item.kind === 'event' || item.kind === 'decision')).slice(-MAX_QUEUED); } catch { items = []; }
  let sending = false;
  let off = false;

  function persist() {
    try { save(items); } catch { /* the in-memory queue is enough */ }
  }

  function add(kind, data) {
    if (off) return;
    items.push({ kind, data, tries: 0 });
    if (items.length > MAX_QUEUED) items = items.slice(-MAX_QUEUED);
    persist();
  }

  // Decisions go before the answers that point at them; the server saves them first too.
  function nextBatch() {
    const decisions = items.filter(item => item.kind === 'decision').slice(0, MAX_BATCH);
    const events = items.filter(item => item.kind === 'event').slice(0, MAX_BATCH);
    return { decisions, events };
  }

  async function flush() {
    if (sending || off || !items.length) return;
    sending = true;
    const batch = nextBatch();
    const taken = new Set([...batch.decisions, ...batch.events]);
    let response;
    try {
      response = await send({ tz_offset: tzOffset(), decisions: batch.decisions.map(item => item.data), events: batch.events.map(item => item.data) });
    } catch {
      response = { status: 0 };
    }
    const status = response?.status || 0;
    if (status >= 200 && status < 300) {
      items = items.filter(item => !taken.has(item));
      // Logging is switched off or not set up on the server: stop collecting for this page.
      if (response.data && response.data.logged === false) { off = true; items = []; }
    } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      items = items.filter(item => !taken.has(item)); // refused: retrying won't help
    } else {
      taken.forEach(item => { item.tries += 1; });
      items = items.filter(item => item.tries < MAX_TRIES);
    }
    persist();
    sending = false;
  }

  return {
    decision(data) { add('decision', data); },
    event(data) { add('event', data); },
    flush,
    pending: () => items.length,
    isOff: () => off,
  };
}
