import { useEffect, useRef } from 'react';
import { getToken, tryRefreshToken } from './api';
import { readUserValue, writeUserValue } from './userStore';
import { answerTimer, confidenceFor, createQueue, formatFor, itemFingerprint, outcomeFor } from './learningEvents.mjs';

// Sends what students answer to POST /learning-events (see lib/learningEvents.mjs). Every call
// here is fire-and-forget: nothing on a study screen waits for it or shows its errors.

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SEND_DELAY_MS = 4000;
const SEND_TIMEOUT_MS = 10000;
const QUEUE_KEY = 'cordiaLearningQueue';
const VIEWS_KEY = 'cordiaLearningViews';
const VIEW_TTL_MS = 14 * 86400000;

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// One id per page load, so a Learn sitting's decisions group together.
const SESSION_ID = typeof window === 'undefined' ? null : uuid();
let queue = null;
let timer = null;

async function send(body, keepalive = false) {
  const token = getToken();
  if (!token) return { status: 0 };
  // A send that hangs would hold the queue; give up and retry later instead.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(API + '/learning-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      keepalive,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) {
    // An expired sign-in: refresh it and try again on the next send.
    tryRefreshToken().catch(() => {});
    return { status: 0 };
  }
  let data = null;
  try { data = await response.json(); } catch { /* no body */ }
  return { status: response.status, data };
}

function getQueue() {
  if (typeof window === 'undefined') return null;
  if (!queue) {
    let keepalive = false;
    queue = createQueue({
      send: body => send(body, keepalive),
      load: () => readUserValue(QUEUE_KEY, []),
      save: items => writeUserValue(QUEUE_KEY, items),
      tzOffset: () => -new Date().getTimezoneOffset(),
    });
    const flushNow = () => { keepalive = true; queue.flush().finally(() => { keepalive = false; }); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
    window.addEventListener('pagehide', flushNow);
    if (queue.pending()) schedule();
  }
  return queue;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const current = getQueue();
    current.flush().finally(() => { if (current.pending() && !current.isOff()) schedule(); });
  }, SEND_DELAY_MS);
}

function quietly(fn) {
  try { return fn(); } catch { return null; }
}

// Explain views a student opened for a question, waiting for its next answer: a view counts for
// the answer that follows it.
function takeView(item) {
  const views = readUserValue(VIEWS_KEY, {}) || {};
  const entry = views[item];
  if (!entry) return null;
  delete views[item];
  writeUserValue(VIEWS_KEY, views);
  return Date.now() - entry.at < VIEW_TTL_MS ? entry.view : null;
}

export function noteView(guideId, questionText, view) {
  quietly(() => {
    const print = itemFingerprint(questionText);
    if (!guideId || !print || !view) return;
    const views = readUserValue(VIEWS_KEY, {}) || {};
    views[`${guideId}:${print}`] = { view: String(view).slice(0, 40), at: Date.now() };
    const kept = Object.entries(views).sort((a, b) => b[1].at - a[1].at).slice(0, 100);
    writeUserValue(VIEWS_KEY, Object.fromEntries(kept));
  });
}

// One answer. type: the card type (mc, fill, written, self, matching, flashcard, practice).
// credit: 1, 0.5 or 0. timing: from useAnswerTiming().done().
export function logAnswer({ guideId, question, mode, type, credit, confidence = '', timing = null, answerChars = null, decisionId = null }) {
  quietly(() => {
    const format = formatFor(type);
    const print = itemFingerprint(question);
    if (!guideId || !format || !print) return;
    getQueue()?.event({
      guide_id: guideId,
      fingerprint: print,
      decision_id: decisionId,
      mode,
      format,
      outcome: outcomeFor(credit, format),
      confidence: confidenceFor(confidence),
      first_key_ms: timing?.first_key_ms ?? null,
      submit_ms: timing?.submit_ms ?? null,
      hidden_ms: timing?.hidden_ms || 0,
      answer_chars: Number.isFinite(answerChars) ? answerChars : null,
      view_shown: takeView(`${guideId}:${print}`),
      occurred_at: new Date().toISOString(),
    });
    schedule();
  });
}

function device() {
  return quietly(() => (window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer')) || 'unknown';
}

// Learn's choice of format for one question, logged before the question shows.
// decision: from learnEngine.formatDecision. Returns the decision's id, for the answer to point at.
export function logFormatDecision({ guideId, question, decision, context = {} }) {
  return quietly(() => {
    const print = itemFingerprint(question);
    const chosen = formatFor(decision.chosen);
    if (!guideId || !print || !chosen) return null;
    const map = list => list.map(formatFor).filter(Boolean);
    const id = uuid();
    getQueue()?.decision({
      id,
      session_id: SESSION_ID,
      guide_id: guideId,
      fingerprint: print,
      decision_type: 'format',
      policy_version_id: 'format-rules-v0',
      source: decision.source,
      candidates: map(decision.candidates),
      mask_reasons: Object.fromEntries(Object.entries(decision.mask).map(([type, reason]) => [formatFor(type), reason])),
      eligible: map(decision.eligible),
      probs: { [chosen]: 1 },
      chosen,
      propensity: 1,
      seed: 0, // no randomness in phase 1
      context: { ...context, recall: decision.recall, local_hour: new Date().getHours(), device: device() },
    });
    schedule();
    return id;
  });
}

// Times one answer on a card, from when it shows: to the first keypress and to the answer, with
// the time the tab was hidden meanwhile. Call key() from the answer field's keydown and done()
// when the student answers.
export function useAnswerTiming() {
  const ref = useRef(null);
  if (ref.current === null && typeof window !== 'undefined') {
    ref.current = answerTimer(() => performance.now(), document.hidden);
  }
  useEffect(() => {
    const onVisibility = () => ref.current?.visibility(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return {
    key: () => ref.current?.key(),
    done: () => ref.current?.done() || null,
  };
}
