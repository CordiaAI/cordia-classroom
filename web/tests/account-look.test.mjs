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
  };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { pathname: '/library' } };
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
  const react = { useEffect() {}, useState: initial => [initial, () => {}] };
  const supabase = { SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
  const progress = await load('progress.js', { react, './api': api, './supabase': supabase });
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
    store, root, progress, theme, calls,
    signIn: id => localStorage.setItem('authToken', token(id)),
    cachedLook: () => JSON.parse(localStorage.getItem(bootModule.LOOK_KEY) || 'null')?.s,
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

  // B signs in on the same browser. Before B's copy is read the cache is not written, and A's look is not B's:
  // B is painted the Cordia default in Light (never A's dark); after B's copy is read, B has the defaults.
  b.signIn(B);
  b.theme.syncThemeFromAccount();
  assert.equal(b.cachedLook().look, 'paper-clay', 'the cache is not written before B\'s own copy is read');
  b.theme.applyTheme('/library');
  assert.equal(b.root.getAttribute('data-theme'), 'light', 'A\'s dark never paints for B');
  assert.equal(b.root.getAttribute('data-look'), null);
  assert.equal(b.root.getAttribute('data-size'), null);
  assert.equal(b.theme.lookSettings().appearance, 'light');
  await b.progress.loadProgress();
  b.theme.syncThemeFromAccount();
  assert.deepEqual(b.cachedLook(), { ...DEFAULT_SETTINGS, appearance: 'light' });
  assert.equal(b.root.getAttribute('data-look'), null);
  assert.equal(b.root.getAttribute('data-size'), null);
  assert.equal(b.root.getAttribute('data-theme'), 'light');
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
  assert.equal(JSON.parse(localStorage.getItem(bootModule.LOOK_KEY)).u, B, 'the cache now names B');
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
