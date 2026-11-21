// What the Tutor shows while it works (components/TutorThinking.js): one line at a time under the
// breathing Cordia mark. Lines, in priority order:
//   1. real steps the server is on ("Reading <title>", "Drawing a diagram"), read from GET /tutor/steps
//      while /chat runs, and shown the moment they arrive;
//   2. lines about the question, from POST /tutor/status (one light-model call made beside /chat, so the
//      answer never waits for it), shown one after another every LINE_MS;
//   3. "Reading your question" until those arrive, or if that call fails or is slow.
// Backend: backend/services/tutor_status.py. The voice mode will reuse this.

export const FALLBACK_LINE = 'Reading your question';
export const LINE_MS = 2200;
// A line stays at least this long before a real step replaces it, so a step is never flashed past too fast to read.
export const MIN_HOLD_MS = 1200;
export const STEP_POLL_MS = 1000;
// After a failed poll (offline, a 429, a server error) the next one waits twice as long, up to this; a good one resets it.
export const STEP_POLL_MAX_MS = 15000;
const STATUS_TIMEOUT_MS = 6000;

const cleanLines = list => (Array.isArray(list) ? list : []).filter(line => typeof line === 'string' && line.trim()).map(line => line.trim());

// The first line shown: the newest real step, else the fallback.
export function firstLine(steps = []) {
  return cleanLines(steps).at(-1) || FALLBACK_LINE;
}

// The line to move to after `current`, LINE_MS later. A real step is followed by the question's lines
// (steps are not shown again: the Tutor has moved on); the question's lines go round; the fallback
// moves to the first of them once there are some. With nothing to move to, the line stays, except a step
// the server took back (a diagram that was never drawn): that one gives way to the newest true step or the fallback.
export function nextLine({ current, steps = [], lines = [] }) {
  const done = cleanLines(steps);
  const topic = cleanLines(lines);
  const step = done.indexOf(current);
  if (step !== -1) return done[step + 1] || topic[0] || current;
  const at = topic.indexOf(current);
  if (at !== -1) return topic[(at + 1) % topic.length];
  return topic[0] || done.at(-1) || FALLBACK_LINE;
}

// How long to wait before a new step may replace the line, given when the line last changed. 0 = now.
export function holdFor({ changedAt, now, holdMs = MIN_HOLD_MS }) {
  return Math.max(0, Math.ceil(changedAt + holdMs - now));
}

// The steps not shown yet, oldest first. `shown` is every step text already on screen, in order (a text shown twice
// is there twice). The server's list can shrink (a step it took back) as well as grow, so steps are matched by text,
// never by position: a step is never skipped because a newer one arrived while it waited out the hold, or because an
// earlier one was taken back.
export function pendingSteps({ steps = [], shown = [] }) {
  const left = new Map();
  for (const text of cleanLines(shown)) left.set(text, (left.get(text) || 0) + 1);
  return cleanLines(steps).filter(text => {
    const times = left.get(text) || 0;
    if (times) left.set(text, times - 1);
    return !times;
  });
}

// Asks for the question's lines. onLines(lines) runs only if they arrive before cancel(); a failed or
// slow call gives nothing, and the fallback line stays.
export function requestStatusLines({ call, question, title = '', className = '', onLines }) {
  let cancelled = false;
  Promise.resolve()
    .then(() => call('/tutor/status', {
      method: 'POST',
      quiet: true,
      quietLimit: true,
      timeoutMs: STATUS_TIMEOUT_MS,
      body: JSON.stringify({ question: String(question || '').slice(0, 2000), title: String(title || '').slice(0, 200), class_name: String(className || '').slice(0, 200) }),
    }))
    .then(data => {
      const lines = cleanLines(data?.lines);
      if (!cancelled && lines.length) onLines(lines);
    })
    .catch(() => {});
  return () => { cancelled = true; };
}

// Reads the real steps of the running request about once a second until cancel(). onSteps(steps) gets
// every step so far, oldest first, so a step shorter than one poll is still shown.
// A failed poll (nothing came back, or a refusal such as 429) is silent, never logged, and the next one waits
// twice as long as the last (up to STEP_POLL_MAX_MS) until one works again; the line the student sees stays.
export function nextPollDelay({ failures = 0, everyMs = STEP_POLL_MS }) {
  return failures ? Math.min(everyMs * 2 ** failures, Math.max(everyMs, STEP_POLL_MAX_MS)) : everyMs;
}

export function pollSteps({ call, sessionId, onSteps, everyMs = STEP_POLL_MS }) {
  let cancelled = false;
  let timer = null;
  let failures = 0;
  const poll = async () => {
    if (cancelled) return;
    let data = null;
    try {
      data = await call(`/tutor/steps?session_id=${encodeURIComponent(sessionId)}`, { timeoutMs: STATUS_TIMEOUT_MS, quiet: true, quietLimit: true });
    } catch { /* a missed poll only delays the next step */ }
    if (cancelled) return;
    const worked = Array.isArray(data?.steps) && !data?.detail;
    failures = worked ? 0 : failures + 1;
    const steps = cleanLines(data?.steps);
    if (worked && steps.length) onSteps(steps);
    timer = setTimeout(poll, nextPollDelay({ failures, everyMs }));
  };
  timer = setTimeout(poll, everyMs * 0.7);
  return () => { cancelled = true; clearTimeout(timer); };
}
