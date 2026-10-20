const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const mark = read('web', 'components', 'AcademicInfinityMark.js');
const styles = read('web', 'styles', 'globals.css');
const system = read('web', 'styles', 'system.css');
const tokens = read('web', 'styles', 'tokens.css');
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
  assert.ok(tokens.includes(token), `missing visual token ${token}`);
}
assert.match(styles, /prefers-reduced-motion/);
// The redesign's exact tokens: one olive accent, glass for accents only.
// One token file: one olive accent, muted = ink at 64%, three surface levels, one hairline.
for (const token of ['--canvas: #EDF2F4', '--ink: #171B18', '--muted: rgba(23, 27, 24, 0.64)', '--olive: #536149', '--olive-press: #3D4937', '--surface-card: rgba(255, 255, 252, 0.55)', '--surface-raised: rgba(255, 255, 252, 0.86)', '--hairline: rgba(23, 27, 24, 0.08)']) {
  assert.ok(tokens.includes(token), `missing design token ${token}`);
}
assert.match(system, /prefers-reduced-motion/);
assert.match(tokens, /--lg-filter: blur\(26px\) saturate\(185%\)/);
// One nav: three places plus New, each a real route; the Tutor is a bubble.
const nav = sidebar.split('const navItems = [')[1].split('];')[0];
assert.deepEqual([...nav.matchAll(/label: '([^']+)', href: '([^']+)'/g)].map(match => `${match[1]} ${match[2]}`), ['Today /dashboard', 'Library /library', 'Canvas /canvas']);
for (const label of ['Progress', 'Settings', 'Appearance', 'Plan', 'Help', 'Sign out']) {
  assert.ok(sidebar.includes(`label: '${label}'`), `missing account menu item ${label}`);
}
assert.match(dashboard, /notes: '\/smartnotes'/);
assert.match(publicPage, /AcademicInfinityMark/);
assert.match(install, /AcademicInfinityMark/);
const classroomStyles = read('web', 'styles', 'classroom.css');
// Both webfonts are self-hosted with swap and a Georgia fallback (never Times).
assert.match(tokens, /--font-sans: 'Manrope'/);
assert.match(tokens, /--font-display: 'Newsreader', Georgia, serif/);
assert.match(tokens, /font-family: Newsreader; src: url\('\/fonts\/newsreader\.ttf'\)[^}]*font-display: swap/);
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
