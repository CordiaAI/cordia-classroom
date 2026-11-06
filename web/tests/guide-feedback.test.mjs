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
