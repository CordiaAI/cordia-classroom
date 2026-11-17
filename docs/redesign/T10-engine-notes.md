# T10 engine: hand-off notes for the "Make it yours" sheet

This is the engine half of T10: token variants and settings logic. There is no sheet, no entry point and
no UI here. With default settings the app renders exactly as before: every token that existed was
compared before and after in a browser, light and dark, with no differences.

## Attributes on `<html>`

Set by `applySettings`. Default values set no attribute.

| Attribute | Values | Default (no attribute) |
| --- | --- | --- |
| `data-accent` | `ocean` `indigo` `clay` `rose` `plum` `graphite` `teal` `custom` | olive (Cordia) |
| `data-bg` | `dusk` `paper` `meadow` | clouds |
| `data-font` | `clean` `bookish` `friendly` `readable` | cordia (Newsreader + Quicksand) |
| `data-size` | `small` (0.9) `large` (1.125) `larger` (1.25) | default (1) |
| `data-glass` | `clearer` `solid` `frosted` | auto: frosted, or solid when the device asks for reduced transparency |
| `data-theme` | `light` `dark` | set from Appearance (already how light/dark worked) |

`data-glass="frosted"` is set only when the student asks for it, so it beats the device's reduced
transparency. Without it the existing media query still makes glass solid.

Custom accent: `data-accent="custom"` plus 11 inline custom properties on `<html>` (`--ca-l-*` for light,
`--ca-d-*` for dark; the list is `ACCENT_VARIABLES` in `lib/accentMath.mjs`). The curated accents set the
same seeds in `tokens.css`, and two rules there map the seeds onto the olive tokens. No component has
theme code.

Swatches for the sheet, which never change with the student's picks: `--swatch-accent-<id>` (the light
fill of each of the eight accents) and `--swatch-bg-<clouds|dusk|paper|meadow>` (tile art, light and dark).
Font previews: `--font-<pair>-display` and `--font-<pair>-ui` for the five pairs.

## Modules (`web/lib/`)

`themeSettings.mjs` (pure, no DOM unless you pass a root)
- Lists: `ACCENTS`, `BACKGROUNDS` (no `photo`), `FONTS`, `SIZES`, `SIZE_SCALE`, `APPEARANCES`
  (`light` `dark` `system`), `GLASS_LEVELS` (`auto` `frosted` `clearer` `solid`), `PRESETS`
  (`{ id, label, accent, bg }`: cordia, ocean, clay, plum, rose, graphite).
- Settings shape: `{ accent, customAccent: '#RRGGBB' | null, bg, font, size, appearance, glass }`.
  `DEFAULT_SETTINGS` is `olive / null / clouds / cordia / default / system / auto`.
- `validateSettings(raw)` returns a complete valid object from anything (object, JSON string, junk).
  Unknown values fall back to the default, unknown keys are dropped, it never throws.
- `isDefaultSettings(s)`, `resolveTheme(s)` returns a preset id or `'custom'`, `applyPreset(s, id)` sets the
  preset's accent and background and keeps the rest.
- `withCustomAccent(s, hex)` returns `{ settings, adjusted, derived }`. Show "Adjusted so text stays
  readable" when `adjusted` is true. For a bad hex it returns the settings unchanged and `derived.ok === false`.
- `attributesFor(s)`, `resolveAppearance(appearance, deviceIsDark)`, `customAccentVariables(s)`, `bootCache(s)`.
- `applySettings(s, { root, deviceIsDark, publicPage })` sets or removes the attributes, writes or clears the
  custom variables, sets `data-theme`. `publicPage: true` applies the Cordia default in light.

`accentMath.mjs`: `deriveAccent(hex)` returns `{ ok, pick, adjusted, adjustedLight, adjustedDark, light, dark }`
(RGB triples for fill, press, ink, on, edge, wash, tint, glassPress), plus `contrast`, `luminance`, `over`,
`parseHex`, `toHex`, `SURFACES`. It works in OKLab so hue holds, darkens the light-mode fill until it is 4.5:1
as text on the worst glass and 4.5:1 under white text, and lightens the dark-mode fill until the dark label on
it (and on its pressed shade) is 4.5:1 and it stands 3:1 clear of a card. `adjusted` is true when the light fill
had to move, or the dark one had to move far more than the usual light-to-dark lift (near-black can't be
shown on dark panes as picked).

`themeBoot.mjs`: `bootScript(lightSignedOutList)` is the first-paint script string used by `pages/_document.js`.
`theme.js` (the existing file, same exports as before) now also exports `lookSettings()`, `saveLook(settings)`
and `applyTheme`/`syncThemeFromAccount` handle the whole look. `setThemePreference` still works and now just
sets the appearance.

## Where settings are saved

The light/dark choice was saved in `progress.theme` (Supabase user metadata, key `cordia`) with a
`localStorage` copy. The look is saved the same way, as `progress.look` (about 120 bytes), so it needs
**no new column or table and no migration**, and it saves to the account today. `progress.js` merges it like
`theme` (whichever copy changed last). The device copy is `localStorage.cordiaLook`, written by `saveLook`
(`{ s: settings, a: attributes, ap: appearance, v: customVariables, f: fontFiles }`). The account save is the
same quiet delayed one progress already uses; if it fails the device copy stays. `progress.theme` is still
written when the appearance is Light or Dark, for older tabs.

## First paint and public pages

The script in `_document.js` reads `cordiaLook`, sets `data-theme` and the attributes and variables, and adds
`<link rel="preload">` for the saved font pair's files, so nothing flashes the default. With no saved look it
falls back to the old `theme` key, then to Match device. Public pages use the same list that kept them light
before (signed-out visitors on Pricing, policy and guide pages; `/`, `/login`, `/signup`, `/reset-password`;
`/print/*` in `theme.js`): they get no attributes and light, and moving to one from the app clears the look.
Signed-in students on Pricing and the policy pages see their own look, as they already saw dark.

## Decisions worth a look

- **Match device is the default** (DESIGN-SPEC 3.5). Before, a student who never chose had light. Now a
  student with a dark device and no saved choice gets dark. Anyone who chose Light or Dark before keeps it.
  To keep the old behaviour, change `DEFAULT_SETTINGS.appearance` to `'light'` and the `'system'` fallbacks in
  `themeBoot.mjs`.
- **Eight accents.** The mockup's second and third dots are almost the same blue (#2F5F86 and #355E86), so the
  eighth is Indigo (#4A55A2). Clay (#865122, mockup #8A5426) and Teal (#2A685B, mockup #2E6B5E) are a shade
  darker than the mockup so they reach 4.5:1 on the most see-through glass.
- **Contrast reference.** Light mode is measured on the darkest 10% of the cloud photo (and the darkest stop of
  Dusk and Meadow) under a Clearer pane; dark mode on the lightest backdrop under a Clearer pane with its sheen.
  Washes are ignored, as in the existing contrast test. Olive passes on every level.
- **Clearer** lowers `glass-fill`, `glass-fill-strong`, `surface-card`, the field fill and the control fill by
  0.12 and blurs 28px. Menus, sheets over text (`surface-raised`) and selected glass are not made more
  see-through.
- **Selection colour** in dark mode stays the light olive it is today (it uses `--accent-rgb`, never the dark tint).

## What is missing or needs the sheet builder

1. **Larger text does not scale most of the app yet.** `data-size` sets the root size (rem sizes and
   `--fs-*` follow), but about 500 `font-size` declarations (444 in `styles/*.css`, 61 in styled-jsx) are in px, as are
   many `font:` shorthands, so they stay put. At Larger only some text grows and the screens look
   uneven. Criterion 8 can't pass until those are rem. A mechanical codemod (`Npx` to `N/16 rem`, same size at
   the default root) fixes it with no visible change at Default; it touches many files other tasks are editing,
   so run it once at the end, over the merged branch. I did not run it.
2. Small is 0.9 (11.7px for 13px text), under the brand's 13px minimum, as the spec states. Floor `--fs-13`
   if that matters.
3. **Fonts**: Inter, Fraunces, Source Sans 3, Nunito and Atkinson Hyperlegible are Latin-subset woff2 files
   from the official `@fontsource` packages (SIL OFL; licences next to them in `public/fonts/`). Other
   scripts fall back to the system font. Fraunces is the standard axes only (no optical size). The Cordia
   pair's two files are still preloaded for everyone by `_document.js`, which is wasted for a student on
   another pair. The sheet's font tiles load all five while it is open.
4. **Backgrounds**: Dusk and Meadow have no photograph in the repo, so they are colour gradients (the same
   art the mockup tiles show). To add photos, put `url('/backgrounds/<name>.webp')` in `--backdrop-sky` for
   that background, with `--backdrop-sky-opacity` and `--backdrop-sky-filter` as the clouds use. Paper is
   plain by design.
5. **Your photo** is not built and not in `BACKGROUNDS`. It needs the private storage bucket Jude has to approve.
6. The sheet should call `saveLook(next)` on every pick (it applies live and saves), use `PRESETS`,
   `resolveTheme`, `applyPreset`, `withCustomAccent` and the swatch tokens, show Match device highlighting
   from `resolveAppearance`, and for Reset keep the previous settings object for Undo and call
   `saveLook(DEFAULT_SETTINGS)`. The existing Sidebar and Settings light/dark toggles still work and write
   the appearance; the sheet replaces them.
7. Radio group for Glass: `auto` should show Frosted selected (or Solid when the device asks for
   reduced transparency).

## Tests

`web/tests/accent-contrast.test.mjs` (every accent, 4 backgrounds, light and dark, 3 glass levels, read from
`tokens.css`; 15 hard colours through the custom-accent maths) and `web/tests/theme-settings.test.mjs`
(validation, defaults leave no attribute, presets, applying, the first-paint script run in a sandbox).
