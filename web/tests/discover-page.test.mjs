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

test('review fixes: the filter row is always there, the clear button and the panel keep focus visibly, titles underline on hover', () => {
  assert.doesNotMatch(files.page, /filtersOn|FiltersOn/, 'the row never depends on what loaded');
  assert.match(files.page, /^\s*<div className="exg-filters" aria-label="Filters" role="group">/m);
  assert.match(files.page, /\.ex-panel:focus-visible \{ border-radius: var\(--r-card\); \}/);
  assert.match(files.page, /\['long', '60\+ questions'\]/);
  assert.match(files.page, /\.exf-wide \{ grid-column: 1 \/ -1; \}/, 'Made by and Length take the whole row on a phone');
  assert.match(files.page, /className="c-search-clear"[^>]*onClick=\{\(\) => \{.*getElementById\('ex-q'\)\?\.focus\(\)/);
  assert.doesNotMatch(files.page, /\.ex-panel \{[^}]*outline/, 'the panel keeps the shared keyboard focus ring');
  assert.match(files.parts, /@media \(hover: hover\) \{ \.exg-card :global\(\.exg-title\):hover \{ text-decoration: underline;/);
});

test('review fixes: suggestions are fetched once for the open page, and "Verified instructor" is said once per card', () => {
  assert.match(files.page, /const got = useRef\(\{\}\)/);
  assert.match(files.page, /\.filter\(\(\[name\]\) => !got\.current\[name\]\)/, 'a list that failed is asked for again, one that arrived is not');
  assert.doesNotMatch(files.page, /useSuggestions\(empty/);
  assert.doesNotMatch(files.parts, /exg-badge|BadgeCheck/);
  assert.match(files.parts, /\{ \.\.\.guide\.author, verified: true \}/);
});
