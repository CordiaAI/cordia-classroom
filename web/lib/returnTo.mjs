// Sign-in round trips for Cordia Assistant, which Classroom serves at /assistant (a separate
// Next.js app behind a rewrite in next.config.js). It sends signed-out students to
// /login?next=/assistant/...; after sign-in they go back there with a full page load.
const KEY = 'cordiaReturnTo';

export function safeReturnTo(value) {
  return typeof value === 'string' && /^\/assistant(\/[\w\-/]*)?(\?[\w=&%-]*)?$/.test(value) ? value : null;
}

// Kept in sessionStorage so it survives the Google OAuth redirect.
export function rememberReturnTo(value) {
  const path = safeReturnTo(value);
  if (path) sessionStorage.setItem(KEY, path);
  return path;
}

export function takeReturnTo() {
  const path = safeReturnTo(sessionStorage.getItem(KEY));
  sessionStorage.removeItem(KEY);
  return path;
}
