import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('top navigation exposes focused study destinations without a separate Classes page', async () => {
  const sidebar = await source('components/Sidebar.js');
  const navigation = sidebar.split('const navItems = [')[1].split('];')[0];
  const labels = [...navigation.matchAll(/\{ label: '([^']+)'/g)].map(match => match[1]);

  assert.deepEqual(labels, ['Home', 'Study', 'Tutor', 'Notes', 'Profile']);
});

test('Practice opens straight into the workspace with a study guide picker', async () => {
  const hub = await source('pages/practice/index.js');
  const workspace = await source('components/PracticeWorkspace.js');

  assert.match(hub, /PracticeWorkspace/);
  assert.doesNotMatch(hub, /Turn studying into doing/);
  assert.match(workspace, /className="practice-guide-picker"/);
  assert.match(workspace, /router\.push\('\/practice\/' \+ value\)/);
  assert.match(workspace, /Create guide or upload file/);
});

test('dashboard routes use the shared workspace and retire the separate Classes view', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /<StudyWorkspaceFrame/);
  assert.match(dashboard, /section="guides"/);

  assert.match(dashboard, /router\.query\.view === 'classes'.*router\.replace\('\/dashboard\?view=guides'\)/s);
  assert.doesNotMatch(dashboard, /My Classes/);
});

test('study surfaces share one floating window and keep optional tools folded away', async () => {
  const frame = await source('components/StudyWorkspaceFrame.js');

  assert.match(frame, /reference-workspace-window/);
  assert.match(frame, /<details className="reference-study-tools">/);
  assert.doesNotMatch(frame, /TutorDrawer|DashboardClassRail/);
});

test('Study Guides owns the Flashcards destination and creation action', async () => {
  const dashboard = await source('pages/dashboard.js');

  assert.match(dashboard, /study-library-tabs/);
  assert.match(dashboard, /router\.push\('\/flashcards'\)/);
  assert.match(dashboard, /New study guide/);
});

test('create page shows manual and upload windows side by side with one Create button', async () => {
  const create = await source('pages/create.js');

  assert.match(create, /Manual Study Guide/);
  assert.match(create, /Upload Files/);
  assert.match(create, /Create study guide/);
  assert.match(create, /include the manual study guide text in the same study guide as the file upload/);
  assert.match(create, /startGuideJob/);
  assert.doesNotMatch(create, /create-tabs|Paste Text/);
});

test('SmartNotes library uses the shared workspace frame', async () => {
  const smartNotes = await source('pages/smartnotes.js');

  assert.match(smartNotes, /<StudyWorkspaceFrame/);
});
