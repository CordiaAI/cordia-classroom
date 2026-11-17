// The new shell's switch (lib/newShell.mjs, lib/server/newShell.mjs): who gets the sidebar, tool
// rail, chat home and composer; that only the server reads the list and the browser gets only a
// boolean; and that Layout renders both paths. Sample ids and emails are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { HOME_ROUTE, SHELL_CACHE, cachedShell, rememberShell, safeDefault, shellBootScript, shellOn, storedUserId } from '../lib/newShell.mjs';
import { pageDefault, shellMode } from '../lib/server/newShell.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const STUDENT = { email: 'sample.student@example.edu', id: '6f1d2c3b-9a8e-4d7c-b6a5-0e1f2a3b4c5d' };
const OTHER = { email: 'another.student@example.edu', id: '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d' };

test('unset is off for everyone in production', () => {
  assert.equal(shellMode({ value: '' }).mode, 'off');
  assert.equal(shellMode({ value: undefined, vercelEnv: 'production' }).mode, 'off');
  assert.equal(shellMode({ value: ' , ' }).mode, 'off');
});

test('all turns it on for every signed-in account', () => {
  assert.equal(shellMode({ value: 'all', vercelEnv: 'production' }).mode, 'on');
  assert.equal(shellMode({ value: ' ALL ' }).mode, 'on');
});

test('a list names accounts by Supabase user id (emails work too), lowercased for the server only', () => {
  const list = shellMode({ value: ` ${STUDENT.id.toUpperCase()} , ${OTHER.email.toUpperCase()}`, vercelEnv: 'production' });
  assert.deepEqual(list, { mode: 'list', entries: [STUDENT.id, OTHER.email] });
});

test('development and preview deployments are on for everyone; off turns it off anywhere', () => {
  assert.equal(shellMode({ vercelEnv: 'preview' }).mode, 'on');
  assert.equal(shellMode({ development: true }).mode, 'on');
  assert.equal(shellMode({ value: STUDENT.id, vercelEnv: 'preview' }).mode, 'on');
  assert.equal(shellMode({ value: 'off', vercelEnv: 'preview' }).mode, 'off');
  assert.equal(shellMode({ value: 'off', development: true }).mode, 'off');
  assert.equal(shellMode({ vercelEnv: 'production' }).mode, 'off');
  assert.equal(HOME_ROUTE, '/home');
});

test('the page knows the answer from the environment only where it needs no account', () => {
  // next dev renders every page on request: exact, off included.
  assert.deepEqual(pageDefault({ NODE_ENV: 'development' }), { fixed: true });
  assert.deepEqual(pageDefault({ NODE_ENV: 'development', CORDIA_NEW_SHELL: STUDENT.id }), { fixed: true });
  assert.deepEqual(pageDefault({ NODE_ENV: 'development', CORDIA_NEW_SHELL: 'off' }), { fixed: false });
  // A production build never reads the variable for the page: a preview build guesses on (the
  // server confirms after load), anything else asks the server.
  const watched = new Proxy({ NODE_ENV: 'production', VERCEL_ENV: 'preview', CORDIA_NEW_SHELL: STUDENT.id }, {
    get(target, key) { if (key === 'CORDIA_NEW_SHELL') throw new Error('read at build'); return target[key]; },
  });
  assert.deepEqual(pageDefault(watched), { guess: true });
  assert.deepEqual(pageDefault({ NODE_ENV: 'production', VERCEL_ENV: 'production', CORDIA_NEW_SHELL: 'all' }), {});
  assert.deepEqual(pageDefault({ NODE_ENV: 'production' }), {});
  // Only two booleans ever reach the page.
  assert.deepEqual(safeDefault({ fixed: true, entries: [STUDENT.id] }), { fixed: true });
  assert.deepEqual(safeDefault({ guess: 'yes' }), {});
});

const storage = values => ({ getItem: key => (key in values ? values[key] : null), setItem: (key, value) => { values[key] = String(value); } });
const token = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const atob = value => Buffer.from(value, 'base64').toString('binary');
const saved = (user, on) => JSON.stringify({ user, on });

test('the device keeps one boolean per account and ignores another account\'s answer', () => {
  const values = {};
  rememberShell(storage(values), STUDENT.id, true);
  assert.deepEqual(Object.keys(values), [SHELL_CACHE]);
  assert.deepEqual(JSON.parse(values[SHELL_CACHE]), { user: STUDENT.id, on: true });
  assert.equal(cachedShell(storage(values), STUDENT.id), true);
  assert.equal(cachedShell(storage(values), OTHER.id), null);
  assert.equal(cachedShell(storage(values), ''), null);
  assert.equal(cachedShell(storage({ [SHELL_CACHE]: '{broken' }), STUDENT.id), null);
  assert.equal(storedUserId(storage({ userId: STUDENT.id }), atob), STUDENT.id);
  assert.equal(storedUserId(storage({ authToken: token({ sub: STUDENT.id }) }), atob), STUDENT.id);
  assert.equal(storedUserId(storage({ authToken: 'not-a-jwt' }), atob), '');
});

test('the page default wins when fixed; then the account\'s answer; then a preview guess', () => {
  assert.equal(shellOn({ fixed: false }, true), false);
  assert.equal(shellOn({ fixed: true }, false), true);
  assert.equal(shellOn({}, true), true);
  assert.equal(shellOn({ guess: true }, false), false);
  assert.equal(shellOn({ guess: true }, null), true);
  assert.equal(shellOn({}, null), false);
});

// Runs the script pages/_document.js puts in <head>, as the browser would before first paint.
function boot(pageDefaultValue, values) {
  const attributes = {};
  const window = {};
  const context = { window, localStorage: storage(values), atob, document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } } };
  vm.runInNewContext(shellBootScript(pageDefaultValue), context);
  return { shell: attributes['data-shell'], window };
}

test('the boot script uses only the cached boolean, for the signed-in account only', () => {
  assert.equal(boot({}, { userId: STUDENT.id, [SHELL_CACHE]: saved(STUDENT.id, true) }).shell, 'new');
  // Freshly signed in: the id comes from the access token.
  assert.equal(boot({}, { authToken: token({ sub: STUDENT.id }), [SHELL_CACHE]: saved(STUDENT.id, true) }).shell, 'new');
  // Another account's answer on a shared device is ignored.
  assert.equal(boot({}, { userId: OTHER.id, [SHELL_CACHE]: saved(STUDENT.id, true) }).shell, undefined);
  assert.equal(boot({}, { userId: STUDENT.id, [SHELL_CACHE]: saved(STUDENT.id, false) }).shell, undefined);
  // No answer yet: today's navigation.
  assert.equal(boot({}, { userId: STUDENT.id }).shell, undefined);
  assert.equal(boot({}, {}).shell, undefined);
  // Development and preview need no account; off in development wins over any cached answer.
  assert.equal(boot({ fixed: true }, {}).shell, 'new');
  assert.equal(boot({ fixed: false }, { userId: STUDENT.id, [SHELL_CACHE]: saved(STUDENT.id, true) }).shell, undefined);
  assert.equal(boot({ guess: true }, {}).shell, 'new');
  assert.equal(boot({ guess: true }, { userId: STUDENT.id, [SHELL_CACHE]: saved(STUDENT.id, false) }).shell, undefined);
  assert.deepEqual({ ...boot({ guess: true }, {}).window.__cordiaShell }, { guess: true });
});

test('the boot script carries no ids, emails, hashes or list, whatever it is given', () => {
  const script = shellBootScript({ fixed: true, entries: [STUDENT.id, STUDENT.email], keys: ['abc'] });
  assert.ok(!script.includes(STUDENT.id) && !script.includes(STUDENT.email) && !script.includes('abc'));
  assert.doesNotMatch(script, /imul|NEW_SHELL/);
});

// Files that run in the browser (or set what the browser gets) never see the list.
const CLIENT_FILES = ['lib/newShell.mjs', 'lib/useNewShell.js', 'lib/api.js', 'pages/home.js', 'pages/index.js', 'components/AuthCard.js', 'pages/auth/callback.js', 'components/Layout.js', 'next.config.js'];

// Code only: lib/newShell.mjs's opening comment names the variable for the owner (it never ships).
const code = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no client module or next.config.js reads the switch\'s variable or hashes an identity', () => {
  for (const file of CLIENT_FILES) {
    const source = code(read(file));
    assert.doesNotMatch(source, /CORDIA_NEW_SHELL|NEXT_PUBLIC_NEW_SHELL/, file);
    assert.doesNotMatch(source, /shellHash|Math\.imul|cyrb53|readIdentity/, file);
  }
  assert.doesNotMatch(read('next.config.js'), /newShell/);
  // The page gets its default from server code only.
  assert.match(read('pages/_document.js'), /shellBootScript\(pageDefault\(\)\)/);
  assert.match(read('pages/_document.js'), /from '\.\.\/lib\/server\/newShell\.mjs'/);
  // Sign-out clears the device's answer.
  assert.match(read('lib/api.js'), /export function clearAuth\(\) \{[\s\S]*?localStorage\.removeItem\('cordiaShell'\);[\s\S]*?\n\}/);
  assert.equal(SHELL_CACHE, 'cordiaShell');
});

test('Layout renders the new shell or today\'s navigation, and only the new shell has the rail', () => {
  const layout = read('components/Layout.js');
  assert.match(layout, /shell \? <Sidebar /);
  assert.match(layout, /<LegacySidebar /);
  assert.match(layout, /\{shell && <ToolRail \/>\}/);
  assert.match(layout, /OWNS_TUTOR = \['\/tutor', '\/home'\]/);
  // Today's navigation is main's sidebar, unchanged: Dashboard, Library, Calendar, Progress, the
  // Assistant, and New opening the New sheet.
  const legacy = read('components/LegacySidebar.js');
  assert.match(legacy, /label: 'Dashboard', href: '\/dashboard'/);
  assert.match(legacy, /className="c-btn c-btn--primary c-side-new" data-spot="new" onClick=\{\(\) => openNewSheet\(\)\}/);
  assert.match(legacy, /<nav className="c-tabbar" aria-label="Primary">/);
  // Its wide-screen styles apply only with the switch off; the new shell's only with it on.
  assert.match(read('styles/legacy-shell.css'), /:where\(:root:not\(\[data-shell='new'\]\)\) \{/);
  assert.match(read('styles/system.css'), /:where\(:root\[data-shell='new'\]\) \{/);
});

test('signed-in students land on the home only with the switch on and a wide window, asked first', () => {
  const runtime = read('lib/useNewShell.js');
  assert.match(runtime, /return shellFlag\(\) && window\.matchMedia\(WIDE_QUERY\)\.matches;/);
  assert.match(runtime, /shellActive\(\) \? HOME_ROUTE : '\/dashboard'/);
  assert.match(runtime, /export async function landingRoute\(\) \{\n  await Promise\.race\(\[refreshShell\(\)/);
  // Only a verified answer is kept, for the account that asked.
  assert.match(runtime, /typeof body\?\.newShell === 'boolean' && getUserId\(\) === userId/);
  for (const page of ['pages/index.js', 'components/AuthCard.js', 'pages/auth/callback.js']) assert.match(read(page), /landingRoute\(\)/, page);
  // The home asks before sending an account without an answer to the Dashboard.
  assert.match(read('pages/home.js'), /if \(shellFlag\(\)\) decide\(true\);\n    else refreshShell\(\)\.then\(decide\);/);
});
