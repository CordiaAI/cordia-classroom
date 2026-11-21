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
export const STEP_POLL_MS = 1000;
const STATUS_TIMEOUT_MS = 6000;

const cleanLines = list => (Array.isArray(list) ? list : []).filter(line => typeof line === 'string' && line.trim()).map(line => line.trim());

// The first line shown: the newest real step, else the fallback.
export function firstLine(steps = []) {
  return cleanLines(steps).at(-1) || FALLBACK_LINE;
}

// The line to move to after `current`, LINE_MS later. A real step is followed by the question's lines
// (steps are not shown again: the Tutor has moved on); the question's lines go round; the fallback
// moves to the first of them once there are some. With nothing to move to, the line stays.
export function nextLine({ current, steps = [], lines = [] }) {
  const done = cleanLines(steps);
  const topic = cleanLines(lines);
  const step = done.indexOf(current);
  if (step !== -1) return done[step + 1] || topic[0] || current;
  const at = topic.indexOf(current);
  if (at !== -1) return topic[(at + 1) % topic.length];
  return topic[0] || current;
}

// Asks for the question's lines. onLines(lines) runs only if they arrive before cancel(); a failed or
// slow call gives nothing, and the fallback line stays.
export function requestStatusLines({ call, question, title = '', className = '', onLines }) {
  let cancelled = false;
  Promise.resolve()
    .then(() => call('/tutor/status', {
      method: 'POST',
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
export function pollSteps({ call, sessionId, onSteps, everyMs = STEP_POLL_MS }) {
  let cancelled = false;
  let timer = null;
  const poll = async () => {
    if (cancelled) return;
    let data = null;
    try {
      data = await call(`/tutor/steps?session_id=${encodeURIComponent(sessionId)}`, { timeoutMs: STATUS_TIMEOUT_MS });
    } catch { /* a missed poll only delays the next step */ }
    if (cancelled) return;
    const steps = cleanLines(data?.steps);
    if (steps.length) onSteps(steps);
    timer = setTimeout(poll, everyMs);
  };
  timer = setTimeout(poll, everyMs * 0.7);
  return () => { cancelled = true; clearTimeout(timer); };
}
