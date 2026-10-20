import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('one navigation: five places, URL-driven active state, Library owns study screens', async () => {
  const sidebar = await source('components/Sidebar.js');
  const navigation = sidebar.split('const navItems = [')[1].split('];')[0];
  const labels = [...navigation.matchAll(/\{ label: '([^']+)'/g)].map(match => match[1]);

  assert.deepEqual(labels, ['Today', 'Library', 'Tutor', 'Notes', 'Calendar']);
  assert.match(sidebar, /const LIBRARY_PATHS = \['\/library', '\/guide', '\/flashcards', '\/quiz', '\/practice'/);
  assert.match(sidebar, /aria-current=\{active === item\.href \? 'page' : undefined\}/);
  assert.match(sidebar, /isMac\(\) \? '⌘K' : 'Ctrl K'/);
  assert.doesNotMatch(sidebar, /workspace-rail/);
});

test('Practice asks for a guide before showing the workspace', async () => {
  const hub = await source('pages/practice/index.js');
  const workspace = await source('components/PracticeWorkspace.js');

  assert.match(hub, /PracticeWorkspace/);
  assert.match(workspace, /if \(!guideId && !upload\)/);
  assert.match(workspace, /className="practice-grid practice-guide-picker"/);
  assert.match(workspace, /Create guide or upload file/);
  assert.match(workspace, /\{problems\.length \? problemIndex \+ 1 : 0\} \/ \{problems\.length \|\| 10\}/);
});

test('old dashboard views redirect to their own routes', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /const LEGACY_VIEWS = \{ guides: '\/library', classes: '\/library', calendar: '\/calendar', notes: '\/smartnotes' \}/);
  assert.match(dashboard, /router\.replace\(legacy\)/);
  assert.doesNotMatch(dashboard, /Study smarter/);
});

test('Today: streak pill, Continue, four tools, no Start card', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /<h1 className="c-title">Today<\/h1>/);
  assert.match(dashboard, /<Flame /);
  assert.doesNotMatch(dashboard, /today-start/);
  for (const tool of ['Quiz', 'Cards', 'Practice', 'Notes']) assert.match(dashboard, new RegExp(`label: '${tool}'`));
});

test('Library holds guides and cards with Undo on delete', async () => {
  const library = await source('pages/library.js');
  const undo = await source('lib/undoDelete.js');

  assert.match(library, /<h1 className="c-title">Library<\/h1>/);
  assert.match(library, /\{ key: 'recent', label: 'Newest' \}/);
  assert.match(library, /name: 'Unsorted'/);
  assert.match(library, /`\$\{due\} due`/);
  assert.match(undo, /export const UNDO_MS = 6000/);
});

test('create keeps manual cards and the file picker with one Create button', async () => {
  const create = await source('pages/create.js');
  const shared = await source('lib/guideCreate.js');

  assert.match(create, /Write cards/);
  assert.match(create, /Upload/);
  assert.match(create, /isEdit \? 'Update' : 'Create'/);
  assert.match(create, /Add your cards\?/);
  assert.match(create, /startGuideJob/);
  assert.match(shared, /export async function generateAndSave/);
  assert.doesNotMatch(create, /create-tabs|Paste Text/);
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

  assert.equal((walkthrough.split('export const DAY_ONE = [')[1].split('\n];')[0].match(/^ {2}\[/gm) || []).length, 9);
  assert.match(controller, /if \(name === active\.on\) advance\(current\)/);
  assert.doesNotMatch(controller, /setTimeout\(\(\) => advance/);
});
