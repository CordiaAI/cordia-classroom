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
| `data-font` | `clean` `bookish` `friendly` `readable` `paper` | cordia (Newsreader + Quicksand) |
| `data-size` | `small` (0.9) `large` (1.125) `larger` (1.25) | default (1) |
| `data-glass` | `clearer` `solid` `frosted` | auto: frosted, or solid when the device asks for reduced transparency |
| `data-look` | `paper-clay` | none: Cordia |
| `data-theme` | `light` `dark` | set from Appearance (already how light/dark worked) |

`data-glass="frosted"` is set only when the student asks for it, so it beats the device's reduced
transparency. Without it the existing media query still makes glass solid.

Custom accent: `data-accent="custom"` plus 11 inline custom properties on `<html>` (`--ca-l-*` for light,
`--ca-d-*` for dark; the list is `ACCENT_VARIABLES` in `lib/accentMath.mjs`). The curated accents set the
same seeds in `tokens.css`, and two rules there map the seeds onto the olive tokens. No component has
theme code.

Swatches for the sheet, which never change with the student's picks: `--swatch-accent-<id>` (the light
fill of each of the eight accents) and `--swatch-bg-<clouds|dusk|paper|meadow>` (tile art, light and dark).
Font previews: `--font-<pair>-display` and `--font-<pair>-ui` for the five pairs (and the sixth, `paper`, see below).

## Modules (`web/lib/`)

`themeSettings.mjs` (pure, no DOM unless you pass a root)
- Lists: `ACCENTS`, `BACKGROUNDS` (no `photo`), `FONTS`, `SIZES`, `SIZE_SCALE`, `APPEARANCES`
  (`light` `dark` `system`), `GLASS_LEVELS` (`auto` `frosted` `clearer` `solid`), `PRESETS`
  (`{ id, label, accent, bg }`: cordia, ocean, clay, plum, rose, graphite; and `paper-clay`, which also carries
  `look`, `font` and `glass`).
- Settings shape: `{ accent, customAccent: '#RRGGBB' | null, bg, font, size, appearance, glass, look }`.
  `DEFAULT_SETTINGS` is `olive / null / clouds / cordia / default / light / auto / none`: **light**, not Match device,
  because "no saved choice" means an existing account. See "Appearance: existing accounts stay on Light" below.
- `validateSettings(raw)` returns a complete valid object from anything (object, JSON string, junk). While a look
  is on it forces `glass: 'solid'`, and it accepts the look's accent (`LOOK_ACCENT`, `paperclay`) only with that look.
  Unknown values fall back to the default, unknown keys are dropped, it never throws.
- `isDefaultSettings(s)`, `resolveTheme(s)` returns a preset id or `'custom'`, `applyPreset(s, id)` sets the
  preset's accent and background and keeps the rest (a look preset also sets its look, font pair and glass).
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
falls back to the old `theme` key, then to **Light** (it cannot know the account yet; a new account's Match device
is written into the cache as soon as the account loads, see below). Public pages use the same list that kept them light
before (signed-out visitors on Pricing, policy and guide pages; `/`, `/login`, `/signup`, `/reset-password`;
`/print/*` in `theme.js`): they get no attributes and light, and moving to one from the app clears the look.
Signed-in students on Pricing and the policy pages see their own look, as they already saw dark.

## Paper & Clay (the seventh preset, a full look)

The owner's values, word for word, are in DESIGN-SPEC 3.5; the source design's `project/tokens.json` agreed with
every one of them (read on 2026-11-17; nothing in it was needed beyond them, see "Derived" below).

**The attribute.** `<html data-look="paper-clay">`. Accent, background, font and glass attributes each switch one
thing; this look switches the whole surface system (fills, text levels, hairlines, corners, shadows, backdrop)
as well, so it needs one attribute of its own that no single other setting can express. The look carries its
own accent, plain-paper backdrop and font pair as defaults: they apply while no `data-accent`, `data-bg` or
`data-font` is set over them. So `data-look="paper-clay"` on its own, set by hand, is the whole look in light and
dark. The engine writes only `data-look` and `data-glass="solid"` for the preset; when the student then picks
something the look would otherwise treat as "unset" it writes it out (`data-accent="olive"`, `data-bg="clouds"`,
`data-font="cordia"`), and any other pick is written as usual and wins. `paperclay` (the accent) and `paper` (the
font pair) are valid settings values but write no attribute while the look is on.

**What it sets** (`styles/tokens.css`, the block before "Less motion"; light `:root[data-look]`, dark
`[data-theme='dark'][data-look]`, with a test that the two set exactly the same tokens): ink, body
(`--text-secondary`), muted, hairline; `--surface-card/-raised` and every glass fill (raised, #FFFFFF / #30302E);
`--glass-inner` (hover) and `--lg-press` (pressed); `--lg-border` (control edge); selected rows, the segmented track
and pill; `--olive-tint` and `--wash` (neutral: washes are never accent); the clay accent seeds (`--ca-l-*`,
`--ca-d-*`); the corners `--r-input 8`, `--r-row 12`, `--r-card 16`, `--r-panel 20`; no blur, sheen or grain
(`--glass-blur`, `--glass-sheen`, `--glass-grain`, `--glass-grain-opacity`); the rim becomes the 1px hairline
(`--glass-rim`, `--glass-rim-border`); and borders before shadows (`--glass-shadow-depth`, `--glass-shadow-edge`,
`--shadow-card`, `--olive-glass-shadow` are all zero, so a resting pane, card, button or chip has no drop shadow;
menus and popovers keep `--lg-depth-float`, which is the source design's menu shadow). The backdrop (canvas,
`--backdrop-sky/-wash/-field` all none) is a separate rule that applies unless a Clouds, Dusk or Meadow
`data-bg` is set. The accent is the primary fill (`--olive`: send, New, primary buttons, checked controls,
progress) and clay-coloured text (`--olive-ink`: active labels, badges, links, icons on the current item).

**New tokens, none read until a look sets them** (so the default look is unchanged; proved with the
resolve-every-token method below): `--text-disabled`, `--line-strong` (button edges, hover), `--control-edge`
(inputs, checkboxes, switches), `--surface-sidebar`, `--shadow-composer`, `--font-reply`, the font pair
`--font-paper-display/-ui/-mono`, and the tile tokens `--swatch-look-paper-clay`, `-edge`, `-dot`, `-ink`, `-font`
and `--swatch-accent-paperclay`.

**Fonts.** Source Serif 4, Instrument Sans and JetBrains Mono, Latin variable woff2 from the official
`@fontsource-variable` packages (SIL OFL; licences next to them), `public/fonts/source-serif-4-latin.woff2`,
`instrument-sans-latin.woff2` (400 to 700), `jetbrains-mono-latin.woff2`. They are `@font-face` rules that
only fetch when a rendered element uses the family: on the default look none of the three is requested (checked).
`FONT_FILES.paper` preloads the serif and the sans before first paint. No italic file: emphasis in a reply is the
browser's slanted serif. `--font-reply` is the UI font, and the one rule that reads it,
`.cordia-tutor-message.ai` in `system.css`, was changed to `font-family: var(--font-reply)`. The look sets it to
the display font, so Tutor replies are serif (and follow the display font if the student changes the pair).

**The tile (for the sheet).** A 92px-wide tile like the other themes, background `--swatch-look-paper-clay` with a
1px `--swatch-look-paper-clay-edge` border and 12px corners; an 8px round dot of `--swatch-look-paper-clay-dot`
at the bottom right; "Aa" in `--swatch-look-paper-clay-ink`, `font-family: var(--swatch-look-paper-clay-font)`, 600,
centred. Name under it: "Paper & Clay".

**Derived, not given by the owner** (the source design had no values for these): the pressed shade of the accent
in light is the owner's "accent hover" `#9C4A27`, and in dark `#E38A6B` (lighter than the fill, as the owner gave it;
Cordia's own dark press is darker); the accent's shadow edge `112, 50, 24` and wash `217, 119, 87` (not drawn while
shadows are off); `--line-strong` at 0.20 of the hairline colour (the source design's `line-strong`); the scrim
(`rgba(20,20,19,.40)` light, `rgba(0,0,0,.65)` dark, the source's overlay); the menu and popover shadow (the source's
`shadow-lg`) and the composer's (`shadow-composer`); the hover wash and the selected row (the owner's hover
colour); the neutral `--olive-tint`. The contrast of the given pairs is checked in `accent-contrast.test.mjs`.

**What the sheet builder must do.**
1. Show Paper & Clay as the seventh tile from `PRESETS` using `resolveTheme` and the tile tokens above.
2. While `settings.look !== 'none'`, Glass is Solid and cannot change (`validateSettings` forces it): show the row
   disabled and set to Solid, with a hint such as "Paper & Clay is always solid".
3. Do not list `paper` in the font tiles (`FONTS` stays five); it appears selected nowhere, so a student who
   changed the font cannot get it back except by picking the preset again. If you want a sixth tile, add it.
4. The Accent row's selected dot while Paper & Clay is current: its accent is not one of the eight (`accent` is
   `paperclay`), so none is selected; the tile row shows "Paper & Clay" selected. Picking any dot or background
   changes `accent`/`bg` and the theme reads "Custom" with the look still on. Picking another theme tile
   (`applyPreset`) leaves the look, puts Glass back to Auto and the font pair back to Cordia if it was still `paper`.
5. Custom accents under the look work as before (the same maths; its surfaces are opaque and lighter or darker than
   the worst glass the maths already assumes).
6. Reset to Cordia (`DEFAULT_SETTINGS`) leaves the look.

**Components that do not follow tokens** (not restyled in this task; they keep Cordia's value under the look):
- Corners hard-coded as `border-radius: Npx` instead of `--r-*`: 312 declarations. Most are 12px (about 137) and 20px
  (about 64) in `styles/globals.css` (30 at 20/24/28), `styles/classroom.css` (20) and styled-jsx; named cases: the
  sidebar `.c-side` and the toast `.c-toast` (24px), `FeedbackModal.js`, `UpgradeModal.js`, `AuthCard.js`,
  `pages/pricing.js`, `pages/oauth/consent.js`, `CalendarDashboard.js` (20px). They stay as they are; the 182
  places that use `--r-*` (the shared `.c-*` components) follow the look.
- The sidebar has no fill of its own: `.c-side` shares `--glass-fill` with cards, so it is raised white under the
  look, not the sidebar paper `#F5F4ED`. `--surface-sidebar` holds the right value; the fix is one line in
  `glass.css` (`.c-side { background: var(--glass-sheen), var(--surface-sidebar) !important; }`), best made where the
  sidebar is rebuilt (T2).
- Control edges: inputs get `--lg-edge` (so the control edge, 3:1) through `--lg-border`, but that token is also the
  edge of the toast, tiles, pricing card and a few menus, which therefore get the control edge too. Checkboxes and
  switches use whatever border their own component has. A `--control-edge` hook in `.c-input`, checkbox and switch
  rules would let `--lg-border` go back to the hairline.
- The composer does not exist in this branch. When it is built, give it `box-shadow: var(--shadow-composer)`;
  anything that uses `--glass-shadow` is flat under the look. Sheets, dialogs, the toast and the Tutor bubble are
  panes, so they are flat with a hairline too (the source design floats dialogs and toasts with `shadow-lg`; that
  needs a floating-pane token they do not have yet). The Tutor bubble keeps a shadow on hover.
- Code: `.practice-code` (`globals.css:736`) and `globals.css:1115` name their own monospace; only
  `.tutor-work` and the Quizlet import use `--font-mono`, so JetBrains Mono reaches those two.
- Progress rings and bars, stars and a few badges read `--olive` or `--olive-ink` directly, so the accent shows
  there as well as on primary actions (nothing at token level can tell a ring from a button).
- `.pricing-card`, the print pages and the note paper keep their own paper (public pages never get the look; note
  paper is cream in both themes by design).

## Appearance: existing accounts stay on Light

**The rule (the owner's decision, Jude):** "For appearance, existing accounts with no saved choice stay on Light;
only accounts created after T10 ships default to Match device." DESIGN-SPEC 3.5's "Match device (the default)"
therefore applies to new accounts only. Anyone who has saved Light, Dark or Match device gets what they saved.
Signed-out and public pages are unchanged (always Cordia default, light).

**The mechanism (no database change).** One cut-off compared with the account's creation time:

- `NEW_ACCOUNT_CUTOFF` in `web/lib/themeSettings.mjs`: an ISO date-time. An account created **on or after** it is
  new (default Match device); one created before it, **or whose creation time is not known**, defaults to Light.
  `isNewAccount`, `defaultAppearance(createdAt)`, `defaultSettingsFor(createdAt)` and `accountSettings(raw, createdAt)`
  are the pure helpers (tested); `DEFAULT_SETTINGS.appearance` is `light`, so every fallback elsewhere (junk values,
  a missing value, no account) is Light.
- The creation time is Supabase's own `created_at`, which `progress.js` already receives from `GET /auth/v1/user`
  when the account loads. It is kept on the device as `localStorage.cordiaAccount` (`{ id, created }`, ignored for
  any other account) and read with `accountCreatedAt()`. It is not part of `progress`, so it is never written back
  and does not ride in the token.
- `theme.js`: `lookSettings()` fills a missing appearance from the account's default. `syncThemeFromAccount()`,
  once the account is known and there is no saved look or saved light/dark, writes the default into the device cache
  (`cordiaLook`), so every later first paint already has it. Until the creation time is known it changes nothing.
- First paint (`themeBoot.mjs`): with no cache and no old `theme` key it is **Light**. A cached Match device follows
  the device. So an existing student on a new browser never flashes dark; a new account's first paint on a new
  browser is Light and turns to Match device when the account has loaded (the one unavoidable change), and is right
  from the start after that.
- Why this over writing the default into a new account's saved look at sign-up: sign-up has several routes (email,
  SMS, OAuth, the extension) and some give no session to save with, so "no saved choice" would sometimes still mean
  a new account; this one rule needs no sign-up change, writes nothing, and when it cannot tell it says Light.

**Where the cut-off is set, and what the owner must do.** `NEW_ACCOUNT_CUTOFF` in `web/lib/themeSettings.mjs` is the
only place. It ships as a **placeholder, `2099-01-01T00:00:00Z`, so nobody counts as new** and everyone with no saved
choice stays on Light. **The owner sets it to the moment T10 ships** (UTC, for example `2026-12-01T00:00:00Z`) in the
release commit. Set it too early and accounts made between that moment and the release get Match device; set it too
late and accounts made after the release stay on Light until it is corrected. It never moves an existing account.

**Pull request description must carry this line:** "Existing accounts with no saved appearance stay on Light; only
accounts created after this ships default to Match device."

**For the sheet builder.** Reset to Cordia must save `defaultLook()` (exported by `theme.js`), not `DEFAULT_SETTINGS`:
the first keeps Light for an existing account, the second is the legacy default and is only the right answer for
everything except appearance. Build the sheet's next settings from `lookSettings()` (as you must anyway) and Match
device shows selected for a new account with no saved choice, Light for an existing one.

## Decisions worth a look

- **Match device is the default for new accounts only** (DESIGN-SPEC 3.5, the owner's decision above). Light for
  every existing account that never chose.
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
3. **Fonts**: Inter, Fraunces, Source Sans 3, Nunito, Atkinson Hyperlegible and the Paper & Clay trio (Source Serif 4, Instrument Sans, JetBrains Mono) are Latin-subset woff2 files
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
`tokens.css`; 15 hard colours through the custom-accent maths; and Paper & Clay's own pairs on its canvas, sidebar
and raised surfaces in both modes, with the weaker pairs measured and asserted as known numbers) and `web/tests/theme-settings.test.mjs`
(validation, defaults leave no attribute, presets, applying, Paper & Clay's preset, Custom detection, forced Solid, the
font pair and the first-paint script run in a sandbox).
