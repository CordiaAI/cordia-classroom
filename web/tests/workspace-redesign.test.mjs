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

test('Practice asks for a guide, then runs fresh with History', async () => {
  const hub = await source('pages/practice/index.js');
  const workspace = await source('components/PracticeWorkspace.js');
  const problem = await source('components/PracticeProblem.js');

  assert.match(hub, /PracticeWorkspace/);
  assert.match(workspace, /if \(!guideId\)/);
  assert.match(workspace, /data-spot="practice-picker"/);
  assert.match(workspace, /History/);
  assert.doesNotMatch(workspace, /Upload/);
  assert.match(problem, /export function answerTool/);
  assert.match(problem, /'Correct' : 'Not quite'/);
});

test('old dashboard views redirect to their own routes', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /const LEGACY_VIEWS = \{ guides: '\/library', classes: '\/library', calendar: '\/calendar', notes: '\/smartnotes' \}/);
  assert.match(dashboard, /router\.replace\(legacy\)/);
  assert.doesNotMatch(dashboard, /Study smarter/);
});

test('Today: streak pill, Start, study space with reader and Tutor', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /<h1 className="today-title">Today<\/h1>/);
  assert.match(dashboard, /<Flame /);
  assert.match(dashboard, /router\.push\('\/session'\)/);
  assert.match(dashboard, /<StudyDocument/);
  assert.match(dashboard, /<AIChatWidget preferredGuideId=\{studyGuide\.id\} compact \/>/);
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

test('/create opens the New sheet; cards are made in the sheet', async () => {
  const create = await source('pages/create.js');
  const sheet = await source('components/NewSheet.js');
  const shared = await source('lib/guideCreate.js');

  assert.match(create, /openNewSheet/);
  assert.match(sheet, /Make cards myself/);
  assert.match(sheet, /async function saveCards/);
  assert.match(sheet, /startGuideJob/);
  assert.match(shared, /export async function generateAndSave/);
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
