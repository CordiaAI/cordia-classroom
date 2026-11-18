// Make it yours, the sheet (T10 UI): Search words, the Glass row, the Theme row's Custom tile, Reset and Undo,
// and where the sheet opens from (the account menus, Settings › Account › Appearance, Search).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, PRESETS, applyPreset, validateSettings, withCustomAccent } from '../lib/themeSettings.mjs';
import { UNDO_MS, customAccentAdjusted, matchesMakeItYours, pickGlass, sameSettings, shownGlass, themeTiles } from '../lib/makeItYours.mjs';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Search finds the sheet by theme, make it yours, dark mode and appearance, and not by class work', () => {
  for (const query of ['theme', 'Theme', 'make it yours', 'dark mode', 'Dark  mode', 'appearance', 'the', 'light mode', 'text size', 'font']) {
    assert.equal(matchesMakeItYours(query), true, query);
  }
  for (const query of ['', 'th', 'cell biology', 'theory of mind', 'organic chemistry', 'photosynthesis']) {
    assert.equal(matchesMakeItYours(query), false, query);
  }
});

test('Glass shows Frosted for auto (Solid when the device asks for less transparency) and is Solid under Paper & Clay', () => {
  assert.equal(shownGlass(DEFAULT_SETTINGS), 'frosted');
  assert.equal(shownGlass(DEFAULT_SETTINGS, true), 'solid');
  assert.equal(shownGlass({ ...DEFAULT_SETTINGS, glass: 'clearer' }), 'clearer');
  const look = applyPreset(DEFAULT_SETTINGS, 'paper-clay');
  assert.equal(shownGlass(look), 'solid');
  // Picking the level the device would get anyway saves auto, so it keeps following the device.
  assert.equal(pickGlass(DEFAULT_SETTINGS, 'frosted').glass, 'auto');
  assert.equal(pickGlass(DEFAULT_SETTINGS, 'solid', true).glass, 'auto');
  assert.equal(pickGlass(DEFAULT_SETTINGS, 'solid').glass, 'solid');
  assert.equal(pickGlass(look, 'frosted').glass, 'solid', 'a look keeps Solid');
});

test('Theme row: seven presets, one chosen; Custom appears once the accent or background leaves a preset', () => {
  const tiles = themeTiles(DEFAULT_SETTINGS);
  assert.deepEqual(tiles.map(tile => tile.id), PRESETS.map(preset => preset.id));
  assert.equal(tiles.length, 7);
  assert.deepEqual(tiles.filter(tile => tile.chosen).map(tile => tile.id), ['cordia']);
  const meadow = themeTiles({ ...DEFAULT_SETTINGS, bg: 'meadow' });
  assert.equal(meadow.at(-1).id, 'custom');
  assert.deepEqual(meadow.filter(tile => tile.chosen).map(tile => tile.id), ['custom']);
  // Under Paper & Clay a new font keeps the theme; a new accent or background makes it Custom.
  const look = applyPreset(DEFAULT_SETTINGS, 'paper-clay');
  assert.equal(themeTiles({ ...look, font: 'readable' }).find(tile => tile.chosen).id, 'paper-clay');
  assert.equal(themeTiles({ ...look, accent: 'teal' }).find(tile => tile.chosen).id, 'custom');
  assert.equal(themeTiles({ ...look, bg: 'dusk' }).find(tile => tile.chosen).id, 'custom');
});

test('the sheet says when a custom accent was adjusted', () => {
  const pale = withCustomAccent(DEFAULT_SETTINGS, '#F7E967').settings;
  assert.equal(customAccentAdjusted(pale), true);
  const ocean = withCustomAccent(DEFAULT_SETTINGS, '#2F5F86').settings;
  assert.equal(customAccentAdjusted(ocean), false);
  assert.equal(customAccentAdjusted(DEFAULT_SETTINGS), false);
});

test('Reset saves the account default and Undo puts back exactly what was there, for 6 seconds', async () => {
  assert.equal(UNDO_MS, 6000);
  const picked = validateSettings({ ...applyPreset(DEFAULT_SETTINGS, 'plum'), font: 'readable', size: 'larger', appearance: 'dark' });
  assert.equal(sameSettings(picked, validateSettings(JSON.parse(JSON.stringify(picked)))), true);
  assert.equal(sameSettings(picked, DEFAULT_SETTINGS), false);
  const sheet = await source('components/MakeItYours.js');
  // Reset keeps an existing account on Light: it saves defaultLook(), never DEFAULT_SETTINGS.
  assert.match(sheet, /commit\(defaultLook\(\)\)/);
  assert.doesNotMatch(sheet, /DEFAULT_SETTINGS/);
  assert.match(sheet, /saveLook\(undo\.previous\)/);
});

test('the sheet opens from the account menus, Settings and Search, in both navigations', async () => {
  for (const file of ['components/Sidebar.js', 'components/LegacySidebar.js']) {
    const nav = await source(file);
    assert.match(nav, /label: 'Make it yours', icon: Palette, onSelect: \(\) => openMakeItYours\(\)/, file);
    assert.doesNotMatch(nav, /setThemePreference|Dark theme|Light theme/, file);
  }
  const search = await source('components/SearchModal.js');
  assert.match(search, /matchesMakeItYours\(q\)/);
  assert.match(search, /openMakeItYours\(openerRef\.current\)/);
  const settings = await source('pages/settings.js');
  assert.match(settings, /openMakeItYours\(event\.currentTarget\)/);
  // Mounted in the signed-in Layout, outside the new-shell switch, so every student gets it at every width.
  const layout = await source('components/Layout.js');
  assert.match(layout, /<MakeItYoursHost \/>/);
});

test('the sheet is a labelled modal dialog with real radio controls, and never says Claude', async () => {
  const sheet = await source('components/MakeItYours.js');
  assert.match(sheet, /role="dialog" aria-modal="true" aria-labelledby="miy-title"/);
  for (const group of ['theme', 'accent', 'bg', 'font']) assert.match(sheet, new RegExp(`role="radiogroup" aria-labelledby="miy-l-${group}"`));
  for (const label of ['size', 'appearance', 'glass']) assert.match(sheet, new RegExp(`<SegmentedControl kind="radio" labelledBy="miy-l-${label}"`));
  assert.doesNotMatch(sheet, /Claude|Anthropic/);
  assert.doesNotMatch(sheet, /transition:\s*all/);
});
