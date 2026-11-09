// Tutor data controls in the web app: delete one saved chat (Past chats), clear Tutor memory
// (Settings › Tutor) and download my data (Settings › Account). The routes and their owner-only
// checks are tested in tests/test_tutor_data_controls.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a saved chat is deleted only after the confirm step', async () => {
  const widget = await read('../components/AIChatWidget.js');
  assert.match(widget, /onClick=\{\(\) => setDeletingChat\(chat\)\}/, 'the trash button only opens the confirmation');
  assert.match(widget, /<ConfirmDialog\s+title="Delete this chat\?"[\s\S]*?onConfirm=\{\(\) => deleteSavedChat\(deletingChat\)\}/);
  assert.match(widget, /apiFetch\(`\/tutor\/chats\/\$\{encodeURIComponent\(chat\.id\)\}`, \{ method: 'DELETE' \}\)/);
});

test('memory can be forgotten one at a time or all at once, after a confirm step', async () => {
  const memory = await read('../components/MemorySettings.js');
  assert.match(memory, /apiFetch\(`\/memories\/\$\{memory\.id\}`, \{ method: 'DELETE' \}\)/);
  assert.match(memory, /onClick=\{\(\) => setClearing\(true\)\}>Clear all</);
  assert.match(memory, /<ConfirmDialog[\s\S]*?onConfirm=\{forgetAll\}/);
  assert.match(memory, /apiFetch\('\/memories', \{ method: 'DELETE' \}\)/);
  assert.doesNotMatch(memory, /are never kept/, 'the sensitive-detail rule is an instruction to the AI, not a guarantee');
  const settings = await read('../pages/settings.js');
  assert.match(settings, /<MemorySettings \/>/);
});

test('Settings › Account downloads the account export', async () => {
  const settings = await read('../pages/settings.js');
  assert.match(settings, /Download my data/);
  assert.match(settings, /await downloadMyData\(\)/);
  const helper = await read('../lib/accountExport.js');
  assert.match(helper, /\/auth\/account\/export/);
});
