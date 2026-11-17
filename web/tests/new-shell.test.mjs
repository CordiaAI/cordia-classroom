// The new shell's switch (lib/newShell.mjs): who gets the sidebar, tool rail, chat home and
// composer, how the setting reaches the browser, and that Layout renders both paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { HOME_ROUTE, OFF, builtSetting, readIdentity, shellBootScript, shellHash, shellOnFor, shellSetting } from '../lib/newShell.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const STUDENT = { email: 'maya.okafor@southalabama.edu', id: '6f1d2c3b-9a8e-4d7c-b6a5-0e1f2a3b4c5d' };
const OTHER = { email: 'devon.reyes@southalabama.edu', id: '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d' };

test('unset is off for everyone in production', () => {
  assert.deepEqual(shellSetting({ value: '' }), OFF);
  assert.deepEqual(shellSetting({ value: undefined, vercelEnv: 'production' }), OFF);
  assert.equal(shellOnFor(shellSetting({}), [STUDENT.email, STUDENT.id]), false);
});

test('all turns it on for every account', () => {
  const setting = shellSetting({ value: 'all', vercelEnv: 'production' });
  assert.equal(setting.all, true);
  assert.equal(shellOnFor(setting, [OTHER.email]), true);
  assert.equal(shellOnFor(shellSetting({ value: ' ALL ' }), []), true);
});

test('an allowlist turns it on for the accounts on it, by email or user id, and no one else', () => {
  const byEmail = shellSetting({ value: ` ${STUDENT.email.toUpperCase()} , someone.else@usouthal.edu`, vercelEnv: 'production' });
  assert.equal(byEmail.all, false);
  assert.equal(shellOnFor(byEmail, [STUDENT.email, STUDENT.id]), true);
  assert.equal(shellOnFor(byEmail, [OTHER.email, OTHER.id]), false);
  const byId = shellSetting({ value: STUDENT.id });
  assert.equal(shellOnFor(byId, ['', STUDENT.id]), true);
  assert.equal(shellOnFor(byId, [OTHER.id]), false);
  assert.equal(shellOnFor(byId, []), false);
});

test('the list reaches the browser as hashes, never as written', () => {
  const setting = shellSetting({ value: `${STUDENT.email},${STUDENT.id}` });
  const json = JSON.stringify(setting);
  assert.ok(!json.includes('maya') && !json.includes(STUDENT.id));
  assert.equal(setting.keys.length, 2);
  assert.equal(shellHash(' Maya.Okafor@SouthAlabama.edu '), shellHash(STUDENT.email));
  assert.notEqual(shellHash(STUDENT.email), shellHash(OTHER.email));
});

test('preview deployments and local development are on for everyone; off turns it off anywhere', () => {
  assert.equal(shellSetting({ vercelEnv: 'preview' }).all, true);
  assert.equal(shellSetting({ development: true }).all, true);
  assert.equal(shellSetting({ value: STUDENT.email, vercelEnv: 'preview' }).all, true);
  assert.deepEqual(shellSetting({ value: 'off', vercelEnv: 'preview' }), OFF);
  assert.deepEqual(shellSetting({ value: 'off', development: true }), OFF);
  assert.equal(shellSetting({ vercelEnv: 'production' }).all, false);
});

test('the built setting round-trips, and anything malformed is off', () => {
  const setting = shellSetting({ value: STUDENT.email });
  assert.deepEqual(builtSetting(JSON.stringify(setting)), setting);
  assert.deepEqual(builtSetting(''), OFF);
  assert.deepEqual(builtSetting('{not json'), OFF);
  assert.equal(HOME_ROUTE, '/home');
});

const storage = values => ({ getItem: key => (key in values ? values[key] : null) });
const token = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const atob = value => Buffer.from(value, 'base64').toString('binary');

test('the signed-in account is read from the cache and from the access token', () => {
  assert.deepEqual(readIdentity(storage({ userEmail: STUDENT.email, userId: STUDENT.id }), atob), [STUDENT.email, STUDENT.id]);
  const fresh = readIdentity(storage({ authToken: token({ sub: STUDENT.id, email: STUDENT.email }) }), atob);
  assert.ok(fresh.includes(STUDENT.email) && fresh.includes(STUDENT.id));
  assert.deepEqual(readIdentity(storage({ authToken: 'not-a-jwt' }), atob), []);
});

// Runs the script pages/_document.js puts in <head>, as the browser would before first paint.
function boot(setting, values) {
  const attributes = {};
  const context = { localStorage: storage(values), atob, document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } } };
  vm.runInNewContext(shellBootScript(setting), context);
  return attributes['data-shell'];
}

test('the boot script marks <html> before first paint for the right accounts only', () => {
  const list = shellSetting({ value: STUDENT.email });
  assert.equal(boot(list, { userEmail: STUDENT.email }), 'new');
  assert.equal(boot(list, { authToken: token({ sub: 'x', email: STUDENT.email }) }), 'new');
  assert.equal(boot(list, { userEmail: OTHER.email }), undefined);
  assert.equal(boot(list, {}), undefined);
  assert.equal(boot(shellSetting({ value: 'all' }), {}), 'new');
  assert.equal(boot(OFF, { userEmail: STUDENT.email }), undefined);
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
  assert.match(read('pages/_document.js'), /shellBootScript\(builtSetting\(process\.env\.NEXT_PUBLIC_NEW_SHELL\)\)/);
});

test('signed-in students land on the home only with the switch on and a wide window', () => {
  const runtime = read('lib/useNewShell.js');
  assert.match(runtime, /return shellFlag\(\) && window\.matchMedia\(WIDE_QUERY\)\.matches;/);
  assert.match(runtime, /shellActive\(\) \? HOME_ROUTE : '\/dashboard'/);
  for (const page of ['pages/index.js', 'components/AuthCard.js', 'pages/auth/callback.js']) assert.match(read(page), /homeRoute\(\)/, page);
});
