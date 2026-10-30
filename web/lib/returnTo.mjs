// Sign-in round trips: Cordia Assistant, which Classroom serves at /assistant (a separate
// Next.js app behind a rewrite in next.config.js), and the consent page a connected app (Claude,
// say) opens. Both send signed-out students to /login?next=...; after sign-in they go back there
// with a full page load.
const KEY = 'cordiaReturnTo';

export function safeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (/^\/assistant(\/[\w\-/]*)?(\?[\w=&%-]*)?$/.test(value)) return value;
  if (/^\/oauth\/consent\?authorization_id=[\w-]{1,128}$/.test(value)) return value;
  return null;
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
