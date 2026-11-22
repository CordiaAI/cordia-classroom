// Discover's page and its shared states (docs/redesign/DESIGN-SPEC.md 5 and 6): read as source, because
// the rules are about what the files say.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const files = { page: read('../pages/explore.js'), parts: read('../components/DiscoverParts.js') };

test('colours come from tokens, never raw values', () => {
  for (const [name, source] of Object.entries(files)) assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, name);
});

test('no transition: all, no colour or weight change on hover, no skeleton or spinner', () => {
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /transition:\s*all/, name);
    assert.doesNotMatch(source, /:hover[^{]*\{[^}]*(color|font-weight)/, name + ' hover');
    assert.doesNotMatch(source, /skeleton|spinner|shimmer/i, name);
  }
});

test('the page fills the shell column like Progress and Canvas do', () => {
  assert.match(files.page, /\.ex \{ width: min\(var\(--page-max\), 100%\); margin: 0 auto; \}/);
  assert.doesNotMatch(files.page, /860px/);
});

test('every tab loads with the mark after 200ms and fails with a plain retry', () => {
  assert.match(files.parts, /const SHOW_MARK_AFTER = 200/);
  assert.match(files.parts, /Try again/);
  for (const what of ['public sets', 'public classrooms', 'people']) assert.ok(files.page.includes(`<DiscoverRetry what="${what}"`), what);
  assert.doesNotMatch(files.page, /SectionLoader/);
});

test('copy is sentence case with no exclamation marks, "Lorem" or "Acme"', () => {
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /Lorem|Acme/i, name);
    const strings = [...source.matchAll(/(?:message=|label: |>)(["'`“])([^"'`”<>{}]+)\1/g)].map(match => match[2]);
    for (const copy of strings) assert.ok(!copy.includes('!'), `${name}: ${copy}`);
  }
});
