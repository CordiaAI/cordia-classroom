// Two things about the signed-in account's look on a shared browser (lib/progress.js, lib/theme.js):
// the account's creation time is kept without its user id, and an account with no saved look gets its own
// default look, not the previous account's. The two modules are plain browser ESM with extensionless imports, so
// they are loaded here by hand against a fake localStorage, the real themeSettings/themeBoot and a fake <html>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as settingsModule from '../lib/themeSettings.mjs';
import * as bootModule from '../lib/themeBoot.mjs';

const { DEFAULT_SETTINGS } = settingsModule;

async function load(file, deps) {
  let source = await readFile(new URL(`../lib/${file}`, import.meta.url), 'utf8');
  const names = [];
  source = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?$/gm, (_, list, from) => `const {${list}} = __deps[${JSON.stringify(from)}];`);
  source = source.replace(/^export\s+(async function|function|const|let)\s+(\w+)/gm, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
  return new Function('__deps', `${source}\nreturn { ${names.join(', ')} };`)(deps);
}

function token(sub) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub })}.sig`;
}

function fakeRoot() {
  const attributes = new Map();
  return {
    getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    classList: { add() {}, remove() {} },
    style: { setProperty() {}, removeProperty() {} },
  };
}

// One browser: a localStorage that every account shares, and the two modules wired together.
async function browser({ users = {}, store = new Map() } = {}) {
  const root = fakeRoot();
  const calls = [];
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    get length() { return store.size; },
    key: index => [...store.keys()][index] ?? null,
  };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { pathname: '/library', origin: 'http://localhost' }, postMessage() {} };
  globalThis.document = { documentElement: root };
  globalThis.requestAnimationFrame = callback => callback();
  const api = {
    getToken: () => localStorage.getItem('authToken'),
    getUserId: () => { try { return JSON.parse(Buffer.from(localStorage.getItem('authToken').split('.')[1], 'base64url')).sub; } catch { return ''; } },
  };
  globalThis.fetch = async (_url, options) => {
    const id = api.getUserId();
    calls.push({ id, method: options.method });
    if (options.method !== 'GET') return { ok: true, json: async () => ({}) };
    const user = users[id];
    return { ok: Boolean(user), json: async () => ({ id, created_at: user?.created, user_metadata: user?.meta || {} }) };
  };
  const phone = { formatPhone: value => String(value || '') };
  const react = { useEffect() {}, useState: initial => [initial, () => {}] };
  const supabase = { SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
  const progress = await load('progress.js', { react, './api': api, './supabase': supabase });
  const apiModule = await load('api.js', { './phone.mjs': phone, './themeBoot.mjs': bootModule });
  const theme = await load('theme.js', {
    './useCases/index.mjs': { USE_CASES: [], useCasePath: page => `/${page.slug}` },
    './comparisons/index.mjs': { COMPARISONS: [], comparisonPath: page => `/${page.slug}` },
    './api': api,
    './progress': progress,
    './themeSettings.mjs': settingsModule,
    './themeBoot.mjs': bootModule,
  });
  theme.applyTheme('/library'); // the page the student is on (the default path is a public one)
  return {
    store, root, progress, theme, calls, apiModule,
    // Signing in puts the token and the user id where api.js setToken does.
    signIn: id => { localStorage.setItem('authToken', token(id)); localStorage.setItem('userId', id); },
    // This device's cache of an account's look (by default the signed-in one's).
    cachedLook: (id = api.getUserId()) => JSON.parse(localStorage.getItem(bootModule.lookKeyFor(id)) || 'null')?.s,
  };
}

const EXISTING = '2020-05-05T10:00:00.000Z';
const A = '11111111-aaaa-4aaa-8aaa-111111111111';
const B = '22222222-bbbb-4bbb-8bbb-222222222222';

test('the account creation time is stored on its own, under a per-account key, with no user id in any value', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING } } });
  b.signIn(A);
  await b.progress.loadProgress();
  assert.equal(b.progress.accountCreatedAt(), EXISTING);
  assert.equal(b.store.get(`cordiaAccount:${A}`), EXISTING);
  assert.equal(b.store.has('cordiaAccount'), false, 'the old shared { id, created } slot is not written');
  for (const [key, value] of b.store) {
    if (key === 'authToken') continue;
    if (key.startsWith('cordiaAccount')) assert.equal(String(value).includes(A), false, `${key} holds no user id`);
  }
  // Another account on the same browser does not see it.
  b.signIn(B);
  assert.equal(b.progress.accountCreatedAt(), '');
});

test('an old shared copy is carried over for its own account and then removed', async () => {
  const b = await browser();
  b.signIn(A);
  localStorage.setItem('cordiaAccount', JSON.stringify({ id: A, created: EXISTING }));
  assert.equal(b.progress.accountCreatedAt(), EXISTING);
  assert.equal(b.store.has('cordiaAccount'), false);
  assert.equal(b.store.get(`cordiaAccount:${A}`), EXISTING);
  b.signIn(B);
  localStorage.setItem('cordiaAccount', JSON.stringify({ id: A, created: EXISTING }));
  assert.equal(b.progress.accountCreatedAt(), '', 'another account\'s old copy is never used');
});

test('account switch: B, with no saved look, gets the defaults, not A\'s Paper & Clay and Larger text', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING }, [B]: { created: EXISTING } } });
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, look: 'paper-clay', accent: 'paperclay', font: 'paper', bg: 'paper', size: 'larger', appearance: 'dark' });
  assert.equal(b.cachedLook().look, 'paper-clay');
  assert.equal(b.cachedLook().size, 'larger');
  assert.equal(b.root.getAttribute('data-look'), 'paper-clay');

  // Same account reloading: its own look is what its saved copy says, on the first sync.
  b.theme.syncThemeFromAccount();
  assert.equal(b.cachedLook().look, 'paper-clay');
  assert.equal(b.cachedLook().appearance, 'dark');

  // B signs in on the same browser. A's look is under A's own key, so B finds nothing there: B is painted the Cordia
  // default in Light (never A's dark) from the first frame, and nothing is written for B until B's own copy is read.
  b.signIn(B);
  assert.equal(b.theme.lookSettings().appearance, 'light', 'A\'s dark is not B\'s');
  assert.equal(b.theme.lookSettings().look, 'none');
  b.theme.syncThemeFromAccount();
  assert.equal(b.cachedLook(B), undefined, 'nothing is written for B before B\'s own copy is read');
  assert.equal(b.cachedLook(A).look, 'paper-clay', 'A\'s cache is untouched');
  b.theme.applyTheme('/library');
  assert.equal(b.root.getAttribute('data-theme'), 'light', 'A\'s dark never paints for B');
  assert.equal(b.root.getAttribute('data-look'), null);
  assert.equal(b.root.getAttribute('data-size'), null);
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  assert.deepEqual(b.cachedLook(B), { ...DEFAULT_SETTINGS, appearance: 'light' });
  assert.equal(b.root.getAttribute('data-look'), null);
  assert.equal(b.root.getAttribute('data-size'), null);
  assert.equal(b.root.getAttribute('data-theme'), 'light');

  // And back to A: A's own look is there on the very first frame, before anything is read.
  b.signIn(A);
  assert.equal(b.theme.lookSettings().look, 'paper-clay');
  assert.equal(b.theme.lookSettings().size, 'larger');
  assert.equal(b.theme.lookSettings().appearance, 'dark');
});

test('account switch: an old explicit dark choice still carries over as the appearance, the rest at defaults', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING }, [B]: { created: EXISTING, meta: { cordia: { v: 1, at: 5, theme: 'dark' } } } } });
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'plum', size: 'large', appearance: 'light' });
  b.signIn(B);
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  assert.deepEqual(b.cachedLook(), { ...DEFAULT_SETTINGS, appearance: 'dark' });
});

test('account switch: with no creation time known, B is Light (A\'s dark is not B\'s) and the rest is reset', async () => {
  // (Which accounts count as new is tested in theme-settings.test.mjs with its own cut-off.)
  const b = await browser({ users: { [A]: { created: EXISTING } } });
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'plum', size: 'larger', appearance: 'dark' });
  b.signIn(B); // the server does not answer for B: no creation time, no saved look
  await b.progress.loadProgress();
  assert.equal(b.progress.accountCreatedAt(), '');
  b.theme.syncThemeFromAccount();
  assert.deepEqual(b.cachedLook(), { ...DEFAULT_SETTINGS, appearance: 'light' }, 'Light until B\'s creation time is known; everything else is the default');
  assert.ok(b.store.has(`cordiaLook:${B}`), 'B has a cache of its own');
});

test('the same account reloading paints its own saved look, and the sync never resets a saved look', async () => {
  const first = await browser({ users: { [A]: { created: EXISTING } } });
  first.signIn(A);
  await first.progress.loadProgress();
  first.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'ocean', size: 'large', appearance: 'dark' });
  const saved = JSON.stringify(first.cachedLook());

  // A page reload: fresh modules, the same storage, and the server not answered yet. The cache the first-paint
  // script reads is untouched, and the account's own saved copy keeps it that way.
  const again = await browser({ store: first.store });
  assert.equal(again.progress.progressLoaded(), false);
  again.theme.syncThemeFromAccount();
  assert.equal(JSON.stringify(again.cachedLook()), saved, 'before the copy is read, nothing is reset');
  await again.progress.loadProgress();
  again.theme.syncThemeFromAccount();
  assert.equal(JSON.stringify(again.cachedLook()), saved, 'after it, the saved look is the cache');
  assert.equal(again.root.getAttribute('data-size'), 'large');
  assert.equal(again.root.getAttribute('data-theme'), 'dark');
});

// ---------- Per-account look storage (lib/theme.js, lib/themeBoot.mjs, lib/api.js clearAuth) ----------

const lookValues = store => [...store].filter(([key]) => key.startsWith('cordiaLook')).map(([key, value]) => ({ key, value: String(value) }));

test('no user id is in any value the look code writes: the id is only in the key', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING }, [B]: { created: '2031-01-01T00:00:00Z' } } });
  for (const id of [A, B]) {
    b.signIn(id);
    await b.progress.loadProgress();
    b.theme.syncThemeFromAccount();
    b.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'plum', size: 'large', appearance: id === A ? 'dark' : 'system' });
    b.theme.syncThemeFromAccount();
  }
  const written = lookValues(b.store);
  assert.deepEqual(written.map(entry => entry.key).sort(), [`cordiaLook:${A}`, `cordiaLook:${B}`].sort());
  for (const { key, value } of written) {
    for (const id of [A, B]) assert.equal(value.includes(id), false, `${key} holds no user id`);
    assert.equal(Object.hasOwn(JSON.parse(value), 'u'), false, `${key} has no u field`);
  }
  assert.equal(b.store.has('cordiaLook'), false, 'the shared key is never written');
  // The creation-time and progress copies keep to the same rule.
  for (const [key, value] of b.store) if (key.startsWith('cordiaAccount')) assert.equal(String(value).includes(A), false, key);
});

test('signing out removes every look kept on this device, and the shared light/dark key with them', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING }, [B]: { created: EXISTING } } });
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'plum', appearance: 'dark' });
  b.signIn(B);
  await b.progress.loadProgress();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, size: 'large', appearance: 'light' });
  localStorage.setItem('cordiaLook', JSON.stringify({ s: DEFAULT_SETTINGS })); // an old shared cache, too
  assert.equal(lookValues(b.store).length, 3);
  assert.equal(localStorage.getItem('theme'), 'light');
  b.apiModule.clearAuth();
  assert.deepEqual(lookValues(b.store), []);
  assert.equal(localStorage.getItem('theme'), null);
  assert.equal(localStorage.getItem('authToken'), null);
  // The next account to sign in starts from the Cordia default.
  b.signIn(A);
  assert.equal(b.theme.lookSettings().accent, 'olive');
  assert.equal(b.theme.lookSettings().appearance, 'light');
});

test('another account never shows the previous look at any step, and the same account gets its own back on the first frame', async () => {
  const A_LOOK = { ...DEFAULT_SETTINGS, look: 'paper-clay', accent: 'paperclay', font: 'paper', bg: 'paper', size: 'larger', appearance: 'dark' };
  const b = await browser({ users: { [A]: { created: EXISTING, meta: { cordia: { v: 1, at: 5, look: A_LOOK, theme: 'dark' } } }, [B]: { created: EXISTING } } });
  const frames = [];
  const frame = who => { b.theme.applyTheme('/library'); frames.push({ who, theme: b.root.getAttribute('data-theme'), look: b.root.getAttribute('data-look'), size: b.root.getAttribute('data-size') }); };
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  frame('A'); // A's look, from the server
  // B signs in (a different account on the same browser, no sign-out between): every frame is the default, to the end.
  b.signIn(B);
  frame('B first frame');
  b.theme.syncThemeFromAccount();
  frame('B before its copy is read');
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  frame('B after');
  // A returns: its own look on the first frame, with nothing read yet.
  b.signIn(A);
  frame('A returns, first frame');
  const byWho = Object.fromEntries(frames.map(f => [f.who, f]));
  assert.deepEqual([byWho.A.theme, byWho.A.look, byWho.A.size], ['dark', 'paper-clay', 'larger']);
  for (const who of ['B first frame', 'B before its copy is read', 'B after']) assert.deepEqual([byWho[who].theme, byWho[who].look, byWho[who].size], ['light', null, null], who);
  assert.deepEqual([byWho['A returns, first frame'].theme, byWho['A returns, first frame'].look, byWho['A returns, first frame'].size], ['dark', 'paper-clay', 'larger']);
});

test('the one shared cache from before the keys is carried over once, for an account with none, then removed', async () => {
  const OLD = { s: { ...DEFAULT_SETTINGS, accent: 'ocean', size: 'large', appearance: 'dark' }, ap: 'dark', a: { 'data-accent': 'ocean' }, v: {}, f: [] };
  // Unstamped: this account's (as before).
  const unstamped = await browser();
  unstamped.signIn(A);
  localStorage.setItem('cordiaLook', JSON.stringify(OLD));
  assert.equal(unstamped.theme.lookSettings().accent, 'ocean');
  assert.equal(unstamped.store.has('cordiaLook'), false, 'the old key is removed');
  assert.equal(unstamped.cachedLook(A).accent, 'ocean');
  assert.equal(Object.hasOwn(JSON.parse(unstamped.store.get(`cordiaLook:${A}`)), 'u'), false);
  // Stamped with this account: carried over, the stamp dropped.
  const own = await browser();
  own.signIn(A);
  localStorage.setItem('cordiaLook', JSON.stringify({ ...OLD, u: A }));
  assert.equal(own.theme.lookSettings().size, 'large');
  assert.equal(own.store.has('cordiaLook'), false);
  assert.equal(own.store.get(`cordiaLook:${A}`).includes(A), false);
  // Stamped with another account: not this one's, and gone.
  const theirs = await browser();
  theirs.signIn(B);
  localStorage.setItem('cordiaLook', JSON.stringify({ ...OLD, u: A }));
  assert.equal(theirs.theme.lookSettings().accent, 'olive');
  assert.equal(theirs.store.has('cordiaLook'), false);
  assert.equal(theirs.store.has(`cordiaLook:${B}`), false);
  // With a cache of its own, the old one is left alone by the read and the account keeps its own.
  const both = await browser();
  both.signIn(A);
  both.theme.saveLook({ ...DEFAULT_SETTINGS, accent: 'plum' });
  localStorage.setItem('cordiaLook', JSON.stringify(OLD));
  assert.equal(both.theme.lookSettings().accent, 'plum');
});

test('the old light/dark key is not trusted while another account\'s look is on this browser', async () => {
  const b = await browser({ users: { [A]: { created: EXISTING }, [B]: { created: EXISTING } } });
  b.signIn(A);
  await b.progress.loadProgress();
  b.theme.saveLook({ ...DEFAULT_SETTINGS, appearance: 'dark' }); // writes theme=dark for older tabs
  assert.equal(localStorage.getItem('theme'), 'dark');
  b.signIn(B);
  assert.equal(b.theme.lookSettings().appearance, 'light', 'A\'s dark, through the shared key, is not B\'s');
  // A device that has never held a per-account look (older than this) still honours its light/dark key.
  const old = await browser();
  old.signIn(A);
  localStorage.setItem('theme', 'dark');
  assert.equal(old.theme.lookSettings().appearance, 'dark');
});

test('"no saved look" is only believed once the server has answered: a look that is on its way is never replaced by the default', async () => {
  const SAVED = { ...DEFAULT_SETTINGS, accent: 'ocean', size: 'large', appearance: 'dark' };
  const b = await browser({ users: { [A]: { created: EXISTING, meta: { cordia: { v: 1, at: 5, look: SAVED, theme: 'dark' } } } } });
  b.signIn(A);
  const loading = b.progress.loadProgress(); // the local copy is read at once; the server has not answered
  assert.equal(b.progress.progressLoaded(), true);
  assert.equal(b.progress.progressRead(), false);
  b.theme.syncThemeFromAccount();
  assert.equal(b.cachedLook(A), undefined, 'the default look is not written while the account\'s own is on its way');
  await loading;
  assert.equal(b.progress.progressRead(), true);
  b.theme.syncThemeFromAccount();
  assert.deepEqual(b.cachedLook(A), SAVED);
  assert.equal(b.root.getAttribute('data-size'), 'large');
  // An account that really has none gets its default once the server has answered (here, with nothing).
  const none = await browser({ users: { [A]: { created: EXISTING } } });
  none.signIn(A);
  await none.progress.loadProgress();
  none.theme.syncThemeFromAccount();
  assert.deepEqual(none.cachedLook(A), { ...DEFAULT_SETTINGS, appearance: 'light' });
  // A failed read counts as answered too: the device copy is all there is.
  const offline = await browser({ users: {} });
  offline.signIn(A);
  await offline.progress.loadProgress();
  assert.equal(offline.progress.progressRead(), true);
});
