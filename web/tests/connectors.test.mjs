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
  assert.match(connectors, /openNewSheet\('paste', \{ text: data\.text, title: data\.title, notice: data\.partial \? PARTIAL_NOTICE : '' \}\)/, 'imports open in the New sheet, saying when a page came in only in part');
});

test('review fixes: the Notion import waits as long as the server reads, and the sheet says when a page came in only in part', async () => {
  const connectors = await source('components/ConnectorsSettings.js');
  assert.match(connectors, /\/import`, \{ method: 'POST', body: JSON\.stringify\(\{ id: file\.id, title: file\.title \}\), timeoutMs: AI_TIMEOUT_MS \}/, 'a page read a few calls at a time is not aborted at 15 s');
  assert.match(connectors, /onChange=\{event => \{ setTarget\(event\.target\.value\); setAdded\(null\); setFailed\(null\); \}\}/, 'a new destination clears the old row error');
  assert.match(connectors, /added\.partial && ` \$\{PARTIAL_NOTICE\}`/, 'the Library path says so too');
  const sheet = await source('components/NewSheet.js');
  assert.match(sheet, /setNotice\(event\.detail\?\.notice \|\| ''\)/);
  assert.match(sheet, /\{notice && <span className="c-meta" role="status">\{notice\}<\/span>\}/);
});

test('review fixes: phone and Larger text details in Settings', async () => {
  const glass = await source('styles/glass.css');
  const system = await source('styles/system.css');
  const settings = await source('pages/settings.js');
  const memory = await source('components/MemorySettings.js');
  // The dark Connected badge ink belongs to the phone list only; desktop keeps the state colour.
  assert.doesNotMatch(glass, /^\[data-theme='dark'\] \.cn-badge\.is-on/m);
  const phone = glass.slice(glass.indexOf('@media (max-width: 560px) {', glass.indexOf('.cn-detail-text')));
  assert.match(phone, /\.cn-badge\.is-on \{ color: var\(--ink\); \}/);
  assert.match(glass, /\.cn-badge\.is-on \{ border-color: transparent; background: var\(--success-bg\); color: var\(--success\); \}/);
  // "Remove my 18+ confirmation" lines up with the text above when it wraps under it.
  assert.match(system, /@media \(max-width: 767px\) \{ \.settings-sub > \.c-btn--quiet \{ margin-inline-start: calc\(var\(--space-4\) \* -1\); \} \}/);
  assert.doesNotMatch(system, /hairline above/);
  // Plan buttons wrap inside the card; Forget is a 44 px target.
  assert.match(settings, /\.plan-actions :global\(\.c-btn\) \{[^}]*min-width: 0;[^}]*white-space: normal;/);
  assert.match(memory, /\.mem :global\(\.mem-forget\) \{[^}]*width: 2\.75rem; height: 2\.75rem;/);
  // rem, not px, in the lines this branch wrote.
  assert.doesNotMatch(glass, /\.cn-card \{ gap: \d+px/);
  assert.doesNotMatch(glass, /\.cn-sheet \{[^}]*\d+px/);
  assert.doesNotMatch(settings, /\.me-card \{[^}]*\d+px|\.billing-current-plan \{[^}]*\d+px|\.plan-actions \{[^}]*\d+px/);
});
