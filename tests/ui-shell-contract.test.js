const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const mark = read('web', 'components', 'AcademicInfinityMark.js');
const styles = read('web', 'styles', 'globals.css');
const system = read('web', 'styles', 'system.css') + read('web', 'styles', 'tokens.css');
const sidebar = read('web', 'components', 'Sidebar.js');
const dashboard = read('web', 'pages', 'dashboard.js');
const login = read('web', 'pages', 'index.js');
const publicPage = read('web', 'components', 'PublicPage.js');
const install = read('web', 'pages', 'install-extension.js');
const documentPage = read('web', 'pages', '_document.js');
const appPage = read('web', 'pages', '_app.js');
const nextConfig = read('web', 'next.config.js');

assert.match(mark, /export default function AcademicInfinityMark/);
assert.match(mark, /open-book|book-pages/);
for (const token of ['--canvas:', '--surface:', '--ink:', '--olive:']) {
  assert.ok(system.includes(token), `missing visual token ${token}`);
}
assert.match(styles, /prefers-reduced-motion/);
// The redesign's exact tokens: one olive accent, glass for accents only.
for (const token of ['--canvas: #EDF2F4', '--ink: #171B18', '--muted: #555C57', '--olive: #536149', '--olive-press: #3D4937', '--glass: rgba(255, 255, 252, 0.74)', '--glass-edge: rgba(255, 255, 255, 0.60)', '--line: rgba(34, 49, 41, 0.12)']) {
  assert.ok(system.includes(token), `missing design token ${token}`);
}
assert.match(system, /prefers-reduced-motion/);
assert.match(system, /backdrop-filter: blur\(24px\) saturate\(160%\)/);
// One nav: five places, each a real route.
const nav = sidebar.split('const navItems = [')[1].split('];')[0];
assert.deepEqual([...nav.matchAll(/label: '([^']+)', href: '([^']+)'/g)].map(match => `${match[1]} ${match[2]}`), ['Today /dashboard', 'Library /library', 'Tutor /tutor', 'Notes /smartnotes', 'Calendar /calendar']);
for (const label of ['Profile', 'Appearance', 'Chrome extension', 'Plan', 'Help', 'Sign out']) {
  assert.ok(sidebar.includes(`/>${label}</button>`), `missing account menu item ${label}`);
}
assert.match(dashboard, /notes: '\/smartnotes'/);
assert.match(publicPage, /AcademicInfinityMark/);
assert.match(install, /Chrome extension/);
assert.match(install, /extensionInstalled/);
const classroomStyles = read('web', 'styles', 'classroom.css');
assert.match(classroomStyles, /--font-sans: 'Manrope'/);
assert.match(classroomStyles, /--font-display: 'Newsreader'/);
assert.doesNotMatch(classroomStyles, /text-transform:\s*uppercase/);
assert.doesNotMatch(documentPage, /Cormorant\+Garamond/);
assert.match(documentPage, /cordia-classroom\.ico/);
assert.match(documentPage, /cordia-classroom-icon\.png/);
assert.match(appPage, /application-name" content="CordiaClassroom"/);
assert.match(appPage, /og:site_name" content="CordiaClassroom"/);
assert.doesNotMatch(documentPage, /autostudy/i);
assert.match(nextConfig, /type: 'host', value: 'autostudyai\.online'/);
assert.match(nextConfig, /https:\/\/classroom\.cordiaai\.io\/\:path\*/);

console.log('UI shell contract passed');
