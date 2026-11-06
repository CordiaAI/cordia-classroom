// Guide page fixes from beta feedback (Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guide = () => readFile(new URL('../pages/guide/[id].js', import.meta.url), 'utf8');

test('15: no "turn your notes into an outline" section; notes-only and lecture notes outline on open', async () => {
  const page = await guide();
  assert.doesNotMatch(page, /Turn them into a tidy outline/);
  assert.doesNotMatch(page, /className="guide-make"/);
  assert.match(page, /function outlineDue\(guide\)/);
  assert.match(page, /if \(!guide\?\.id \|\| notesAsked\.current === guide\.id \|\| !outlineDue\(guide\)\) return;/);
  assert.match(page, /const outlinePending = outlineDue\(guide\) && notesTriedFor !== guide\.id;/);
  assert.match(page, /setUndoNotes\(before\); setToast\('Outline written from your notes'\)/);
  // The study tabs come before the outline.
  assert.ok(page.indexOf('aria-label="Study this guide"') < page.indexOf('className="c-card guide-notes"'));
});

test('16: highlight menus offer Ask, not Explain and Ask; the section Explain (Learn it your way) stays', async () => {
  const outline = await readFile(new URL('../components/OutlineVisuals.js', import.meta.url), 'utf8');
  const reader = await readFile(new URL('../components/StudyDocument.js', import.meta.url), 'utf8');
  const page = await guide();
  for (const menu of [outline, reader]) {
    assert.doesNotMatch(menu, /act\('explain'\)/);
    assert.match(menu, /act\('ask'\)/);
  }
  assert.match(reader, /data-spot=\{offset === 0 \? 'explain' : undefined\}/);
  assert.doesNotMatch(page, /kind === 'explain'/);
  assert.match(page, /else ask\(id, `Explain "\$\{text\}" `\);/);
});
