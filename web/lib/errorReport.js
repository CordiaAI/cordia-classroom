// Sends uncaught errors to /api/client-error (Vercel logs). At most 5 per page load, and
// the same message only once, so a loop can't flood the logs.
let sent = 0;
const seen = new Set();

function send(detail) {
  const key = detail.message;
  if (sent >= 5 || !key || seen.has(key)) return;
  seen.add(key);
  sent += 1;
  const body = JSON.stringify({ ...detail, page: window.location.pathname, version: process.env.NEXT_PUBLIC_APP_VERSION || '' });
  if (!navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' }))) {
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}

export function installErrorReporting() {
  if (typeof window === 'undefined' || window.__cordiaErrors) return;
  window.__cordiaErrors = true;
  window.addEventListener('error', event => {
    // Resource load failures (a broken image) carry no error; skip them.
    if (!event.error && !event.message) return;
    send({ message: event.message, source: event.filename, line: event.lineno, stack: event.error?.stack });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    send({ message: `Unhandled: ${reason?.message || String(reason)}`, stack: reason?.stack });
  });
}
