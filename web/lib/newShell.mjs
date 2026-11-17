// The new app shell (docs/redesign: the sidebar and tool rail, the chat home as the signed-in
// landing route, the composer) sits behind one switch. Pure, so it can be tested in Node
// (web/tests/new-shell.test.mjs); lib/useNewShell.js reads it in the browser and
// pages/_document.js applies it before the first paint.
//
// The owner sets CORDIA_NEW_SHELL in Vercel (read at build time, so a change needs a redeploy):
//   unset               off for everyone in production
//   all                 on for every account
//   a, b, c             on for these accounts: emails or user ids, comma-separated
//   off                 off everywhere, even in development and on preview deployments
// Local development (`next dev`) and Vercel preview deployments are on for everyone unless the
// value is `off`, so a pull request's preview link shows the new shell without any setup.
// Emails and ids never reach the browser as written: next.config.js turns the list into hashes.
// Whatever the switch says, phones (under 768px) keep today's layout and navigation.

export const HOME_ROUTE = '/home';
export const WIDE_QUERY = '(min-width: 768px)';
export const OFF = Object.freeze({ all: false, keys: [] });

// A short, stable hash (cyrb53) of an email or user id. It runs in the boot script in
// pages/_document.js as written here (Function.prototype.toString), so it stays plain ES5.
export function shellHash(value) {
  var str = String(value == null ? '' : value).trim().toLowerCase();
  var h1 = 0xdeadbeef;
  var h2 = 0x41c6ce57;
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The setting the browser gets, from the build's environment: { all, keys } (keys are hashes).
export function shellSetting({ value = '', vercelEnv = '', development = false } = {}) {
  const raw = String(value || '').trim();
  if (/^(off|none)$/i.test(raw)) return OFF;
  if (/^all$/i.test(raw) || development || vercelEnv === 'preview') return { all: true, keys: [] };
  const keys = [...new Set(raw.split(',').map(item => item.trim()).filter(Boolean).map(shellHash))];
  return { all: false, keys };
}

// The setting this build was made with (next.config.js puts it in NEXT_PUBLIC_NEW_SHELL).
export function builtSetting(json = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_NEW_SHELL : '') {
  try {
    const parsed = JSON.parse(json || 'null');
    if (parsed && typeof parsed === 'object') return { all: parsed.all === true, keys: Array.isArray(parsed.keys) ? parsed.keys.map(String) : [] };
  } catch { /* a malformed value is off */ }
  return OFF;
}

// Is the switch on for this account? ids: the signed-in account's email and user id (any may be empty).
export function shellOnFor(setting, ids = []) {
  if (!setting) return false;
  if (setting.all) return true;
  if (!setting.keys?.length) return false;
  return ids.some(id => id && setting.keys.includes(shellHash(id)));
}

// The signed-in account as this browser knows it: the cached email and id (lib/api.js), and the
// same two from the access token, so a fresh sign-in counts before /auth/me answers.
export function readIdentity(storage, decode = typeof atob === 'function' ? atob : null) {
  const ids = [];
  try {
    ids.push(storage.getItem('userEmail'), storage.getItem('userId'));
    const token = storage.getItem('authToken');
    if (token && decode) {
      const payload = JSON.parse(decode(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      ids.push(payload.email, payload.sub);
    }
  } catch { /* storage blocked or a token that isn't a JWT */ }
  return ids.filter(Boolean).map(String);
}

// The script pages/_document.js runs before the first paint: data-shell="new" on <html> when the
// switch is on for whoever is signed in, so the stylesheet lays the page out for the right shell
// and neither shell ever flashes before the other.
export function shellBootScript(setting = OFF) {
  const safe = { all: setting.all === true, keys: (setting.keys || []).map(String) };
  return '(function(){try{var s=' + JSON.stringify(safe) + ';var on=s.all;if(!on&&s.keys.length){var h=' + shellHash.toString()
    + ';var ids=[localStorage.getItem("userEmail"),localStorage.getItem("userId")];var t=localStorage.getItem("authToken");'
    + 'if(t){try{var p=JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));ids.push(p.email,p.sub);}catch(e){}}'
    + 'for(var i=0;i<ids.length;i++){if(ids[i]&&s.keys.indexOf(h(ids[i]))>-1){on=true;break;}}}'
    + 'if(on)document.documentElement.setAttribute("data-shell","new");}catch(e){}})();';
}
