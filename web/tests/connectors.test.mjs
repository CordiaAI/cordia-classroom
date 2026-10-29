import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Settings has a Connectors tab that talks only to the backend', async () => {
  const settings = await source('pages/settings.js');
  const connectors = await source('components/ConnectorsSettings.js');
  assert.match(settings, /\{ key: 'connectors', label: 'Connectors' \}/);
  assert.match(settings, /connections: 'connectors'/, 'old links still land on the tab');
  for (const name of ['Google Calendar', 'Apple Calendar', 'Google Tasks', 'Google Drive', 'Google Docs', 'Notion']) {
    assert.ok((await source('../backend/routers/connectors.py')).includes(name), name);
  }
  assert.match(connectors, /apiFetch\('\/connectors'\)/);
  assert.doesNotMatch(connectors, /composio|COMPOSIO/i, 'the Composio key stays on the server');
  assert.match(connectors, /openNewSheet\('paste', \{ text: data\.text, title: data\.title \}\)/, 'imports open in the New sheet');
});
