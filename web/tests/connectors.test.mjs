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
  assert.match(connectors, /openNewSheet\('paste', \{ text: data\.text, title: data\.title, notice: /, 'imports open in the New sheet, saying when a page came in only in part');
});

test('review fixes: the Notion import waits as long as the server reads, and the sheet says when a page came in only in part', async () => {
  const connectors = await source('components/ConnectorsSettings.js');
  assert.match(connectors, /\/import`, \{ method: 'POST', body: JSON\.stringify\(\{ id: file\.id, title: file\.title \}\), timeoutMs: AI_TIMEOUT_MS \}/, 'a page read a few calls at a time is not aborted at 15 s');
  assert.match(connectors, /onChange=\{event => \{ setTarget\(event\.target\.value\); setAdded\(null\); setFailed\(null\); setHub\(null\); \}\}/, 'a new destination clears the old row error');
  const sheet = await source('components/NewSheet.js');
  assert.match(sheet, /setNotice\(event\.detail\?\.notice \|\| ''\)/);
});

test('F1 follow-up: partial imports are said outside the text, in warning style, and never as success', async () => {
  const connectors = await source('components/ConnectorsSettings.js');
  const sheet = await source('components/NewSheet.js');
  const glass = await source('styles/glass.css');
  const studyPlans = await source('lib/studyPlans.js');
  // The note never says "the last line"; the text is the page's own notes.
  assert.doesNotMatch(connectors, /last line/);
  // Library path: its own line, warning style, with the server's own wording; a kept copy is not "Added".
  assert.match(connectors, /\{added\?\.partial && <p className="cn-warning" role="status">\{added\.note\}<\/p>\}/);
  assert.match(connectors, /added\.kept \? <><a href=\{`\/guide\/\$\{added\.id\}`\}>\{added\.title\}<\/a> is already in Library\.<\/> : <>Added/);
  assert.doesNotMatch(connectors, /cn-notice" role="status">Added[^\n]*partial/);
  // The Library path waits as long as the server reads, like the import: post() already allows 120 s.
  assert.match(studyPlans, /const post = \(url, body, timeoutMs = 120000\)/);
  assert.match(studyPlans, /addToLibrary = [^\n]*post\(`\/connectors\/\$\{connector\}\/library`/);
  // New sheet: the notice sits outside the textarea's label and describes it.
  assert.match(sheet, /\{notice && <p id="new-paste-notice" className="cn-warning" role="status">\{notice\}<\/p>\}\s*<label className="c-field">\s*<span className="sr-only">Text<\/span>/);
  assert.match(sheet, /aria-describedby=\{notice \? 'new-paste-notice' : undefined\}/);
  // A page that is only sub-pages: each name is a button that fills the search, in a neutral block.
  assert.match(connectors, /className="cn-hub" role="status"/);
  // Every sub-page name is a button (wrapping, in a scrolling block); none is cut to "and N more".
  assert.match(connectors, /hub\.names\.map\(\(name, index\) =>/);
  assert.doesNotMatch(connectors, /\$\{hub\.names\.length - /);
  assert.match(glass, /\.cn-hub-name \{[^}]*white-space: normal/);
  assert.match(connectors, /onClick=\{\(\) => \{ setHub\(null\); setQuery\(name\);/);
  assert.match(glass, /\.cn-warning \{[^}]*var\(--warning-bg\)[^}]*var\(--warning\)/);
  assert.doesNotMatch(glass.match(/\.cn-warning \{[^}]*\}/)[0], /#[0-9a-fA-F]{3,8}|rgba?\(/, 'colours come from tokens');
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
