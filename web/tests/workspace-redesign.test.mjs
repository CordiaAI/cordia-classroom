import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('one navigation: Dashboard, Study now, Library, Calendar, Progress, then classes and Assistant; Tutor is a bubble; Library owns study screens, notes and lectures', async () => {
  const sidebar = await source('components/Sidebar.js');
  const navigation = sidebar.split('const navItems = [')[1].split('];')[0];
  const labels = [...navigation.matchAll(/label: '([^']+)'/g)].map(match => match[1]);

  assert.deepEqual(labels, ['Dashboard', 'Study now', 'Library', 'Calendar', 'Progress']);
  assert.doesNotMatch(sidebar, /studyItems|label: 'Canvas'/);
  assert.match(sidebar, /'\/smartnotes', '\/lecture'\]/);
  assert.match(sidebar, /<TutorBubble \/>/);
  assert.match(await source('components/TutorBubble.js'), /cordia:tutor-toggle/);
  assert.match(sidebar, /const LIBRARY_PATHS = \['\/library', '\/guide', '\/flashcards', '\/quiz', '\/practice'/);
  assert.match(sidebar, /aria-current=\{active === item\.href \? 'page' : undefined\}/);
  assert.match(sidebar, /isMac\(\) \? '⌘K' : 'Ctrl K'/);
  assert.doesNotMatch(sidebar, /workspace-rail/);
});

test('Practice is picked in Library; the workspace needs a guide or a file', async () => {
  const hub = await source('pages/practice/index.js');
  const workspace = await source('components/PracticeWorkspace.js');
  const library = await source('pages/library.js');

  assert.match(hub, /PracticeWorkspace/);
  assert.match(library, /\{ key: 'practice', label: 'Practice' \}/);
  assert.match(library, /href: '\/practice\/' \+ guide\.id/);
  assert.match(workspace, /if \(!guideId && !upload\)/);
  assert.match(workspace, /router\.replace\('\/library\?tab=practice'\)/);
  assert.match(workspace, /\{problems\.length \? problemIndex \+ 1 : 0\} \/ \{problems\.length \|\| 10\}/);
});

test('old dashboard views redirect to their own routes', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /const LEGACY_VIEWS = \{ guides: '\/library', classes: '\/library', calendar: '\/calendar', notes: '\/smartnotes' \}/);
  assert.match(dashboard, /router\.replace\(legacy\)/);
  assert.doesNotMatch(dashboard, /Study smarter/);
});

test('Dashboard: Continue, Due soon (Canvas when empty), progress strip; tools live under New', async () => {
  const dashboard = await source('pages/dashboard.js');
  const newSheet = await source('components/NewSheet.js');

  assert.match(dashboard, /<h1 className="c-title">Dashboard<\/h1>/);
  assert.doesNotMatch(dashboard, /Daily review|today-review/);
  assert.match(dashboard, /<CanvasConnectButton card [^>]*spot="canvas-connect"/);
  assert.match(dashboard, /href="\/progress"/);
  assert.match(dashboard, /<Flame /);
  assert.doesNotMatch(dashboard, /today-tools/);
  for (const tool of ['Quiz', 'Flashcards', 'Practice', 'Note']) assert.match(newSheet, new RegExp(`label: '${tool}'`));
});

test('Library: one list grouped by class, kind filters (no Notes: notes live in guides), Undo on delete', async () => {
  const library = await source('pages/library.js');
  const undo = await source('lib/undoDelete.js');

  assert.match(library, /<h1 className="c-title">Library<\/h1>/);
  assert.match(library, /\{ key: 'recent', label: 'Newest' \}/);
  for (const label of ['All', 'Guides', 'Lectures', 'Flashcards', 'Starred']) assert.match(library, new RegExp(`label: '${label}'`));
  assert.doesNotMatch(library, /label: 'Notes'/);
  assert.match(library, /name: 'Unfiled'/);
  assert.match(library, /href=\{'\/folder\/' \+ folder\.id\} className="lib-group-name/);
  assert.match(library, /path: '\/smart_notes\/' \+ item\.id/);
  assert.match(undo, /item\.path \|\| '\/guides\/' \+ item\.id/);
  assert.match(library, /`\$\{item.due\} due`/);
  assert.match(undo, /export const UNDO_MS = 6000/);
});

test('create is only for writing cards and Quizlet import; uploads go through the New sheet', async () => {
  const create = await source('pages/create.js');
  const sheet = await source('components/NewSheet.js');
  const shared = await source('lib/guideCreate.js');

  assert.match(create, /Write cards/);
  assert.match(create, /isEdit \? 'Update' : 'Create'/);
  assert.match(create, /QuizletImport/);
  assert.match(create, /openNewSheet\('upload'\)/);
  assert.doesNotMatch(create, /startGuideJob|extract-file-text|useFileDropZone|generateAndSave/);
  assert.match(sheet, /startGuideJob/);
  assert.match(shared, /export async function generateAndSave/);
});

test('New › Note makes an empty notes guide and opens it', async () => {
  const sheet = await source('components/NewSheet.js');
  const smartnotes = await source('pages/smartnotes.js');

  assert.match(sheet, /async function newNote\(\)/);
  assert.match(sheet, /source_type: 'notes'/);
  assert.doesNotMatch(sheet, /smartnotes\?id=new/);
  assert.doesNotMatch(smartnotes, /id === 'new'\) \{\n\s+const saved/);
});

test('New sheet offers Upload, Paste, Link, Record and a sample', async () => {
  const sheet = await source('components/NewSheet.js');

  for (const option of ['upload', 'paste', 'link', 'record']) assert.match(sheet, new RegExp(`mode: '${option}'`));
  assert.match(sheet, /Try a sample/);
  assert.match(sheet, /data-spot="new-headings"/);
});

test('walkthrough steps advance only on real actions', async () => {
  const walkthrough = await source('lib/walkthrough.js');
  const controller = await source('components/Walkthrough.js');

  assert.equal((walkthrough.split('export const DAY_ONE = [')[1].split('\n];')[0].match(/^ {2}\[/gm) || []).length, 4);
  assert.match(controller, /if \(event\.detail\?\.name === active\.on\) advance\(current\)/);
  assert.doesNotMatch(controller, /setTimeout\(\(\) => advance/);
});

test('Settings: Account (with theme), Tutor (with Explain style), Plan, Connectors; old tabs still land', async () => {
  const settings = await source('pages/settings.js');

  for (const key of ['account', 'tutor', 'plan', 'connectors']) assert.match(settings, new RegExp(`\\{ key: '${key}', label: `));
  assert.doesNotMatch(settings, /key: 'study'|key: 'appearance'|key: 'learn'|<LearnCordia/);
  assert.match(settings, /study: 'tutor', appearance: 'account'/);
  assert.match(settings, /section === 'learn'\).*openHelp\(\)/);
  assert.match(settings, /aria-label="Theme"/);
  assert.match(settings, /<LearningStylePicker /);
});

test('classes and Canvas status are fetched once and shared; Library cards come from the summary', async () => {
  const folders = await source('lib/folders.js');
  const canvas = await source('lib/canvas.js');
  const library = await source('pages/library.js');
  const sidebar = await source('components/Sidebar.js');

  assert.match(folders, /export function loadFolders\(\)/);
  assert.match(folders, /export function invalidateFolders\(/);
  assert.match(canvas, /statusCache\.token === token && Date\.now\(\) - statusCache\.at < STATUS_TTL_MS/);
  for (const name of ['connectCanvas', 'syncCanvas', 'disconnectCanvas']) assert.match(canvas, new RegExp(`export const ${name} = `));
  assert.match(sidebar, /onFoldersChanged\(load\)/);
  assert.doesNotMatch(sidebar, /apiFetch\('\/folders'\)/);
  assert.match(library, /loadFolders\(\), apiFetch\('\/guides\?fields=summary&limit=500'\)/);
  assert.doesNotMatch(library, /\/guides\?limit=100/);
  assert.match(library, /dueCount\(guide\)/);
});

test('Sheets, GitHub, Slack and Dropbox stay hidden unless their flag is on', async () => {
  const flags = await source('lib/featureFlags.js');
  const connectors = await source('components/ConnectorsSettings.js');
  const assignment = await source('components/AssignmentSheet.js');

  assert.match(flags, /export const EXTRA_CONNECTORS = \['gsheets', 'github', 'slack', 'dropbox'\]/);
  assert.match(connectors, /data\.connectors\.filter\(shown\)/);
  assert.match(assignment, /EXTRA_CONNECTORS_ON && data !== null && item\.type !== 'exam' && <RepoLink/);
});
