const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const mark = read('web', 'components', 'AcademicInfinityMark.js');
const styles = read('web', 'styles', 'globals.css');
const sidebar = read('web', 'components', 'Sidebar.js');
const dashboard = read('web', 'pages', 'dashboard.js');
const login = read('web', 'pages', 'index.js');
const install = read('web', 'pages', 'install-extension.js');
const documentPage = read('web', 'pages', '_document.js');
const appPage = read('web', 'pages', '_app.js');
const nextConfig = read('web', 'next.config.js');

assert.match(mark, /export default function AcademicInfinityMark/);
assert.match(mark, /open-book|book-pages/);
for (const token of ['--canvas:', '--surface:', '--ink:', '--olive:']) {
  assert.ok(styles.includes(token), `missing visual token ${token}`);
}
assert.match(styles, /prefers-reduced-motion/);
assert.match(sidebar, /label: 'SmartNotes'/);
assert.match(sidebar, /label: 'Notes', href: '\/smartnotes'/);
for (const label of ['Appearance', 'Your profile', 'Billing', 'Feedback', 'Sign out']) {
  assert.ok(sidebar.includes(label), `missing profile action ${label}`);
}
assert.match(dashboard, /router\.replace\('\/smartnotes'\)/);
assert.match(login, /AcademicInfinityMark/);
assert.match(install, /AcademicInfinityMark/);
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
