// The new app shell (docs/redesign: the sidebar and tool rail, the chat home as the signed-in
// landing route, the composer) sits behind one switch, decided on the server. Pure, so it can be
// tested in Node (web/tests/new-shell.test.mjs); lib/useNewShell.js uses it in the browser and
// pages/_document.js applies it before the first paint.
//
// The owner sets CORDIA_NEW_SHELL in Vercel (Project, Settings, Environment Variables, Production):
//   unset               off for everyone in production
//   all                 on for every signed-in account
//   id, id, id          on for these accounts: Supabase user ids (Authentication, Users, "UID"),
//                       comma-separated. Emails work too, but ids are preferred.
//   off                 off everywhere, even in development and on preview deployments
// Local development (`next dev`) and Vercel preview deployments are on for everyone unless the
// value is `off`, so a pull request's preview link shows the new shell without any setup.
// Vercel applies a changed environment variable only to new deployments: redeploy after changing it.
//
// Only the server reads the variable (lib/server/newShell.mjs, at request time). The browser asks
// GET /api/new-shell with its access token and gets back { newShell: true | false } and nothing else.
// It keeps that answer on the device, paired with the signed-in account's user id (already in the
// browser: lib/api.js), so the boot script can apply it before the first paint; a different account
// on the same device never uses it, sign-out clears it, and every page load asks again in the
// background so turning the switch off takes effect on the next visit. With no answer yet, the page
// shows today's navigation until the server answers.
// Whatever the switch says, phones (under 768px) keep today's layout and navigation.

export const HOME_ROUTE = '/home';
export const WIDE_QUERY = '(min-width: 768px)';
export const SHELL_ENDPOINT = '/api/new-shell';
// localStorage: { user: <the signed-in account's user id>, on: true | false }.
export const SHELL_CACHE = 'cordiaShell';

// The signed-in account's user id as this browser knows it (lib/api.js getUserId: the cached id,
// else the access token's subject), or ''.
export function storedUserId(storage, decode = typeof atob === 'function' ? atob : null) {
  try {
    const cached = storage.getItem('userId');
    if (cached) return String(cached);
    const token = storage.getItem('authToken');
    if (!token || !decode) return '';
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(decode(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).sub || '');
  } catch {
    return '';
  }
}

// The server's last answer for this account on this device: true, false, or null (none yet, or it
// belongs to another account).
export function cachedShell(storage, userId) {
  if (!userId) return null;
  try {
    const saved = JSON.parse(storage.getItem(SHELL_CACHE) || 'null');
    return saved && saved.user === String(userId) && typeof saved.on === 'boolean' ? saved.on : null;
  } catch {
    return null;
  }
}

export function rememberShell(storage, userId, on) {
  if (!userId || typeof on !== 'boolean') return;
  try { storage.setItem(SHELL_CACHE, JSON.stringify({ user: String(userId), on })); } catch { /* storage blocked */ }
}

// Is the shell on, from what the page knows now? pageDefault comes from the server's environment
// (lib/server/newShell.mjs pageDefault): { fixed } settles it for everyone; otherwise the account's
// cached answer; otherwise { guess } (a preview deployment), else off.
export function shellOn(pageDefault, cached) {
  if (pageDefault && typeof pageDefault.fixed === 'boolean') return pageDefault.fixed;
  if (typeof cached === 'boolean') return cached;
  return Boolean(pageDefault && pageDefault.guess === true);
}

// Only the two booleans pass into the page, whatever is handed in.
export function safeDefault(pageDefault) {
  if (pageDefault && typeof pageDefault.fixed === 'boolean') return { fixed: pageDefault.fixed };
  return pageDefault && pageDefault.guess === true ? { guess: true } : {};
}

// The script pages/_document.js runs before the first paint: data-shell="new" on <html> when the
// shell is on (shellOn above, with the cached answer for the signed-in account), so the stylesheet
// lays the page out for the right shell and neither shell flashes before the other. It also leaves
// the page's default in window.__cordiaShell for lib/useNewShell.js. Plain ES5.
export function shellBootScript(pageDefault) {
  return '(function(){var d=' + JSON.stringify(safeDefault(pageDefault)) + ';window.__cordiaShell=d;try{var on=d.fixed;'
    + 'if(typeof on!=="boolean"){var s=localStorage,u=s.getItem("userId"),c=null;'
    + 'if(!u){var t=s.getItem("authToken");if(t){try{var e=t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");while(e.length%4)e+="=";u=JSON.parse(atob(e)).sub;}catch(x){}}}'
    + 'if(u){try{var v=JSON.parse(s.getItem("' + SHELL_CACHE + '")||"null");if(v&&v.user===String(u)&&typeof v.on==="boolean")c=v.on;}catch(x){}}'
    + 'on=c===null?d.guess===true:c;}'
    + 'if(on)document.documentElement.setAttribute("data-shell","new");}catch(x){}})();';
}
