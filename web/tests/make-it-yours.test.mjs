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

test('Paper & Clay keeps the accent for primary actions: rings, bars, stars and badges read --meter, ink under the look', async () => {
  const tokens = await source('styles/tokens.css');
  assert.match(tokens, /--meter: var\(--olive\);\n  --meter-ink: var\(--olive-ink\);\n  --on-meter: var\(--on-olive\);/);
  assert.equal((tokens.match(/--meter: var\(--ink\); --meter-ink: var\(--ink\); --on-meter: var\(--surface-raised\);/g) || []).length, 2, 'light and dark look');
  const system = await source('styles/system.css');
  assert.match(system, /\.c-ring-fill \{ stroke: var\(--meter\)/);
  assert.match(system, /\.c-bar > span \{[^}]*background: var\(--meter\)/);
  for (const [file, pattern] of [['components/NotificationBell.js', /\.nb-badge \{[^}]*background: var\(--meter\)/], ['components/AccountMenu.js', /\.acct-badge \{[^}]*background: var\(--meter\)/], ['pages/library.js', /\.lib-star\.is-on \{ color: var\(--meter-ink\)/]]) {
    assert.match(await source(file), pattern, file);
  }
  // A pressed star: the pressed-icon rule reads --icon-pressed, which .c-star sets to --meter-ink, so no page rule
  // has to outrank it (it did not, and the stars stayed clay).
  const glass = await source('styles/glass.css');
  assert.match(glass, /\.c-icon-btn:is\(\[aria-pressed='true'\], \.is-on\)\) :is\(svg\.lucide, \.lucide\) \{ color: var\(--icon-pressed, var\(--olive-ink\)\) !important; \}/);
  assert.match(glass, /\.c-star \{ --icon-pressed: var\(--meter-ink\); \}/);
  for (const file of ['pages/guide/[id].js', 'components/FlashcardViewer.js', 'pages/library.js']) assert.match(await source(file), /className=\{'c-icon-btn c-star/, file);
  // Settings: the avatar, its initials, the section icons, and the sidebar's account-row initials.
  const settings = await source('pages/settings.js');
  assert.match(settings, /\.me-avatar \{[^}]*background: var\(--meter\); color: var\(--on-meter\)/);
  assert.match(settings, /\.settings-row-label :global\(\.lucide\) \{ color: var\(--meter-ink\); \}/);
  assert.match(system, /\.c-side \.c-side-avatar \{[^}]*color: var\(--meter-ink\)/);
});

test('components a look must reach: sidebar fill, control edges, composer and floating-pane shadows, code font, corners', async () => {
  const tokens = await source('styles/tokens.css');
  for (const hook of ['--field-edge: var(--lg-edge);', '--check-edge: var(--muted);', '--toggle-edge: var(--line);', '--r-pane: 24px;', '--pane-float-shadow: var(--glass-shadow);', '--surface-sidebar: var(--glass-fill);', '--shadow-composer: var(--glass-shadow);']) assert.ok(tokens.includes(hook), hook);
  assert.equal((tokens.match(/--lg-border: var\(--hairline\);/g) || []).length, 2, 'under the look the shared edge goes back to the hairline');
  const glass = await source('styles/glass.css');
  assert.match(glass, /\.c-side \{ background: var\(--glass-sheen\), var\(--surface-sidebar\) !important; \}/);
  assert.match(glass, /:is\(\.c-sheet, \.c-toast, \.upgrade-dialog, \.feedback-modal\) \{ box-shadow: var\(--pane-float-shadow\) !important; \}/);
  assert.match(glass, /\.c-input[^{]*\{\n[^}]*border: 1px solid var\(--field-edge\)/);
  const system = await source('styles/system.css');
  assert.match(system, /\.composer \{[^}]*border-radius: var\(--r-panel\)[^}]*box-shadow: var\(--shadow-composer\)/);
  const globals = await source('styles/globals.css');
  assert.doesNotMatch(globals, /Courier New|SFMono-Regular, Consolas/);
});

test('Larger text scales every text size: no font size or line height left in px (fields keep 16px so iOS never zooms)', async () => {
  const { execFileSync } = await import('node:child_process');
  const report = execFileSync(process.execPath, [new URL('../scripts/px-to-rem.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.match(report, /^0 declarations to convert/m, report);
  assert.match(await source('styles/glass.css'), /font-size: 16px !important/);
});
