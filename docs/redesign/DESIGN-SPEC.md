# Chat-first redesign: design spec

This is the design direction for the website-finish gate. Reuse it as written; don't write a new one. Where a mockup in `screens/` and this spec disagree, this spec wins.

The brand rules in the Cordia Classroom design system still hold (olive as the one accent, Newsreader for the few big titles and Quicksand for everything else, sentence case, Lucide icons at 20px and 1.75 stroke, 13px minimum text). This spec adds the chat-first layout and a richer version of the glass.

## 1. Direction

- **Product:** a study app for college students that turns class material into study guides and helps them learn it before the test.
- **Character:** calm, capable, a little warm.
- **World:** a desk by a window. Frosted panes over a pale cloud sky, with olive leaves at the edge of the light.
- **Moment:** a student asks the Tutor for practice and the real Practice board slides out beside the conversation, as its own pane of glass.
- **Signature:** the readiness ring. A thin olive ring with the % next to each class that has an exam coming up, the same ring on the home's Up next row and on the class page's exam card.
- **Concept:** "Everything you need for the next test is one sentence or one click away."

## 2. Glass v2

Glass has to have something behind it, so the backdrop comes first.

### 2.1 Backdrop

- Light: the page is `canvas` with `Backdrops/classroom-clouds.webp` covering it at 92% opacity, blurred 4px, saturate 110%, inset 48px past every edge so the blur never shows an edge. Two washes sit over it: white light from the top left (`radial-gradient(900px 620px at 6% -10%, white 62% → 0 at 64%)`) and a faint olive tint from the bottom right (`radial-gradient(1100px 760px at 104% 112%, #7A8C6B 20% → 0 at 62%)`).
- Dark: the existing dark field of deep olive and charcoal, with the cloud image at 18% so panes still have something to blur.
- The backdrop is decoration: `pointer-events: none`, `user-select: none`, and fixed, so it does not move when the page scrolls.

### 2.2 New tokens

Add these to `tokens.css`. Names may be adjusted to match the file's naming, but every value comes from here.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `glass-fill` | `rgba(248, 250, 247, 0.46)` | `rgba(42, 46, 51, 0.52)` | Resting panes: sidebar, tool rail, cards |
| `glass-fill-strong` | `rgba(250, 251, 249, 0.74)` | `rgba(42, 46, 51, 0.82)` | Composer, tool pane, Learn card, exam card, user message |
| `glass-sheen` | `linear-gradient(180deg, rgba(255,255,255,0.30), rgba(255,255,255,0) 42%)` | `linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0) 42%)` | Top light on every pane |
| `glass-rim` | `linear-gradient(155deg, rgba(255,255,255,0.95), rgba(255,255,255,0.22) 30%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.42))` | `linear-gradient(155deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06) 30%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.12))` | The 1px edge that catches light, bright top-left, fading, faint bottom-right |
| `glass-blur` | `blur(36px) saturate(140%)` | `blur(36px) saturate(115%)` | `backdrop-filter` |
| `glass-shadow` | `inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(23,27,24,0.04), 0 0 0 0.5px rgba(23,27,24,0.08), 0 2px 6px rgba(16,24,16,0.05), 0 24px 56px -20px rgba(34,48,30,0.30)` | `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 0.5px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.30), 0 24px 56px -20px rgba(0,0,0,0.55)` | Depth under panes |
| `glass-grain-opacity` | `0.06` | `0.05` | The existing 180px grain tile |
| `glass-inner` | `rgba(255, 255, 255, 0.38)` | `rgba(255, 255, 255, 0.05)` | Things on glass that need a surface: tile icons, hover pane |
| `olive-glass-sheen` | `linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 55%)` | `linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 55%)` | Over `olive` on primary buttons |
| `olive-glass-shadow` | `inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(0,0,0,0.18), 0 0 0 0.5px rgba(38,48,32,0.40), 0 8px 20px -8px rgba(61,73,55,0.65)` | `inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.4), 0 8px 20px -8px rgba(0,0,0,0.6)` | Primary buttons at rest |
| `olive-glass-shadow-hover` | `olive-glass-shadow` plus `0 0 0 4px rgba(83,97,73,0.14), 0 12px 26px -8px rgba(61,73,55,0.70)` | same pattern with `rgba(195,207,182,0.14)` and `rgba(0,0,0,0.65)` | Primary buttons on hover |
| `selected-glass` | `olive-tint` 13% over `rgba(250,251,249,0.74)` | `olive-tint` 12% over `rgba(42,46,51,0.84)` | Current sidebar item, pressed chip, chosen segment |

### 2.3 The recipe

A pane of glass is:

1. `background: glass-sheen, glass-fill` (or `glass-fill-strong`).
2. `backdrop-filter: glass-blur`.
3. `box-shadow: glass-shadow`.
4. A `::before` layer with the grain tile at `glass-grain-opacity`, under the content (`isolation: isolate` on the pane, `z-index: -1` on the layer).
5. A `::after` layer that draws `glass-rim` as a 1px border, using a mask so only the edge shows (`padding: 1px`, `mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)`), with `pointer-events: none`.

Rules:

- One frost per spot. Anything on glass (rows, chips, tool cards) uses `glass-inner` or nothing; it never blurs again. Popovers and menus that float over other content keep their own frost.
- Nest glass once at most.
- With `prefers-reduced-transparency`, or without `backdrop-filter` support, panes become solid `surface-raised` and the rim stays.
- Flashcard faces and Learn's flip card keep sheen and rim but no blur (a blur breaks the 3D flip).

### 2.4 Olive glass

Primary buttons are `olive-glass-sheen` over `olive`, with `olive-glass-shadow` and `on-olive` text. Press darkens to `olive-press` and scales to 0.97. One olive button per view is the goal; the sidebar's New chat is the standing exception, and the view's own main action (Check answer, Start today's N, Check) is the other.

## 3. Layout and sidebar

### 3.1 Frame

- The page has 12px padding. The sidebar floats at the left, 264px wide, with 24px corners. The tool rail floats at the right, 64px wide, with 24px corners. The chat (or the page) fills the space between them, 12px from each.
- Content tops out at the widths in the screens: the home column is 760px wide, the Learn card 780px, the class page fills the remaining width.
- 1440 × 900 is the reference size. Nothing on the home, chat, class or Learn screens scrolls at that size, except the chat's own message list and the tool pane's body.

### 3.2 Sidebar

From the top, with 14px between groups:

- Brand row: the mark at 30 × 26, "cordia" in Newsreader 20/600, and the fold toggle (36px).
- New chat: full width, 44px, olive glass, square-pen icon. Search below it, 38px, with a ⌘K keycap at the right (12px/600 muted on a 1px hairline ring).
- "CLASSES" heading with a 32px + button, then classes at 36px: a 10px dot in the class's `cover-ink-N`, the course code at 14px/600, and, at the right, the readiness % in tabular 13px muted and a 16px ring (2.25px stroke).
- "RECENT CHATS" heading, then chat titles at 36px, 14px/500, one line with an ellipsis. Recent chats fill the rest of the sidebar's height and scroll inside it.
- The sidebar holds no tools. Every tool lives in the tool rail (3.4).
- Account row at the bottom, above one hairline: a 36px avatar (initials in `olive-ink` on selected glass), the name at 14px/600, the plan and school at 12px muted, and a ⋯ button.
- Hover: `glass-inner` with a white inset top line. Current: `selected-glass` with an `olive` icon. Folded: 72px of icons.

### 3.3 Readiness ring

- The readiness % is Learn's own number (Mastered counts fully, Familiar half, Learning a little) for the review set tied to the class's next exam.
- The ring track is `ink` at 12%; the arc is `olive`, round-capped, starting at 12 o'clock and going clockwise.
- Sizes: 16px in the sidebar, 36px on list rows, 112px on the exam card (8px stroke, the % inside in Newsreader 34/600 tabular).
- The ring has an accessible label: "77% ready for the next exam". With no upcoming exam, there is no ring and no empty placeholder.

### 3.4 Tool rail

- A vertical pane of glass on the right edge: 64px wide, 24px corners, 10px padding top and bottom, running the full height like the sidebar.
- One 44px circular button per tool, 6px apart, centered, each with its 20px Lucide icon in `muted`: Make guide (file-plus), Learn (graduation-cap), Flashcards (layers), Quiz (list-checks), Practice (pencil-line), Library (book-open), Calendar (calendar), Plan my week (calendar-check), Progress (chart-line). "More tools" (ellipsis) sits alone at the bottom.
- Hover shows `glass-inner` and turns the icon `ink`. The current tool (its page is open, or its pane is open beside the chat) uses `selected-glass` with an `olive` icon and `aria-current`.
- Hovering or focusing a button shows its popover to the left of the rail, 14px from it, vertically centered on the button: 232px wide, 16px corners, 12px × 14px padding, solid menu glass (`lg-fill-menu` with the sheen and `shadow-float`). It holds the tool's name at 15/600 `ink` and one line at 13/500 `muted`:
  - Make guide: "Turn slides, PDFs, links or a lecture into a study guide."
  - Learn: "Master every idea before the test, one round at a time."
  - Flashcards: "Review cards when they're due, so they stick."
  - Quiz: "Test yourself. Misses come back until you get them right."
  - Practice: "Work problems on a drawing board and get each one graded."
  - Library: "Every guide, note and lecture, sorted by class."
  - Calendar: "Canvas deadlines and your study blocks in one week."
  - Plan my week: "Fit what's due into the free time you have."
  - Progress: "Your streak, study time and what you know."
  - More tools: "Record a lecture, NCLEX practice, Study now, Dashboard and the Assistant."
- The popover is a real tooltip: `role="tooltip"`, linked with `aria-describedby`, shown on keyboard focus as well as hover, hidden on Escape, and never covering the button itself. It never steals clicks (`pointer-events: none`).
- Clicking a tool: in a chat, it opens that tool as a pane beside the chat (4.3), for the chat's class when there is one. Anywhere else, it opens the tool's own page. Library, Calendar, Plan my week and Progress always open their pages. More tools opens a menu to the left of the rail with the rest of the tools in the feature map.

### 3.5 Make it yours (personal themes)

Every student can make Cordia look like theirs. Everything here changes design tokens only, so every screen follows without its own code.

- **Where:** "Make it yours" in the account row menu, Settings › Account › Appearance, and "theme" in Search. It opens a sheet (`screens/5-make-it-yours.html`): 880px wide, 28px corners, solid menu glass over a 22% `ink` scrim with a 3px blur. On phones it is a full-height sheet.
- **Live:** every pick applies to the whole app at once, behind the sheet. Done and the close button both keep what's applied. "Reset to Cordia" puts every setting back to the defaults and shows an Undo toast for 6 seconds.
- **Theme:** seven presets. Six are an accent plus a background: Cordia (olive, Clouds; the default), Ocean (blue, Clouds), Clay (brown, Paper), Plum (purple, Dusk), Rose (rose, Dusk), Graphite (grey, Paper). The seventh, Paper & Clay, is a full-look preset (see below). Changing the accent or background afterwards marks the theme "Custom".
- **Paper & Clay (full-look preset):** unlike the other presets it switches more than accent and background. Source: Jude's design spec at https://claude.ai/artifact/VP89pXPrHHpo66SJasEY48 (`project/README.md` and `project/tokens.json` there, for anything not listed here). The product UI never uses the word "Claude" or any Anthropic logo.
  - Background: plain paper, no cloud photo, no grain. Glass level forced to Solid (no backdrop blur). Borders before shadows; shadows only on things that float (composer, menus, popovers).
  - Light: canvas `#faf9f5`, sidebar `#f5f4ed`, raised surfaces (composer, cards, menus) `#ffffff`, hover `#f0eee6`, pressed `#e8e6dc`; text `#141413`, body `#3d3d3a`, muted `#6b6a64`, disabled `#9c9a92`; hairline `#1f1e1d1a`, control borders `#8f8c82`; accent `#ae5630`, accent hover `#9c4a27`, text on accent `#ffffff`; clay-coloured text `#a24a29`.
  - Dark: canvas `#262624`, sidebar `#1f1e1d`, raised `#30302e`, hover `#3a3936`, pressed `#45443f`; text `#faf9f5`, body `#c2c0b6`, muted `#a6a39a`, disabled `#85837b`; hairline `#faf9f51f`, control borders `#8a877e`; accent `#d97757`, accent hover `#e38a6b`, text on accent `#1a1918`; clay-coloured text `#e8916f`.
  - Fonts: display and Tutor replies in "Source Serif 4", everything else in "Instrument Sans", code in "JetBrains Mono" (Google Fonts). Picking the preset sets the font pair to these; the student can still change it afterwards.
  - Corners: controls 8px, cards 12 to 16px, composer 20px, chips as pills.
  - The accent appears only on primary actions (send, New chat, checked controls).
  - Theme tile: a paper swatch with a small clay dot and a serif "Aa".
- **Accent:** eight curated swatches (32px dots, the current one with a 2px gap ring) plus Custom, which opens a colour picker. The accent drives everything that is olive today: primary buttons, olive glass, current items in the sidebar and rail, readiness rings, focus rings, links. From one picked colour Cordia derives the press shade, the tint for `selected-glass`, and a lighter version for dark mode, then darkens or lightens it until accent text and icons reach 4.5:1 on glass and white text on olive glass reaches 4.5:1, in both modes. If it had to adjust, it says "Adjusted so text stays readable" under the picker.
- **Background:** Clouds (default), Dusk, Paper (plain warm ivory, no photo), Meadow, and Your photo. Each built-in background has a light and a dark version. Your photo takes a JPG, PNG, WEBP or HEIC up to 10 MB, crops it to fill, and keeps the grain and sheen on top; it needs a private storage bucket that Jude must approve, so until then the tile is hidden.
- **Font:** five pairs, display font for headings and UI font for everything else: Cordia (Newsreader and Quicksand, default), Clean (Inter and Inter), Bookish (Fraunces and Source Sans 3), Friendly (Nunito and Nunito), Readable (Atkinson Hyperlegible for both; its tile notes it's built for dyslexia and low vision). Only the chosen pair loads beyond the default. Sizes and weights in this spec stay the same; each pair maps its own weights to "500/600".
- **Text size:** Small (0.9×), Default, Large (1.125×), Larger (1.25×), scaling the root size so every rem-based size follows. At Larger, no text clips or overlaps at 1440 × 900 or at 390px; layouts reflow.
- **Appearance:** Light, Dark, Match device (the default).
- **Glass:** Frosted (default; this spec's recipe), Clearer (fills 0.12 more see-through, blur 28px), Solid (no backdrop blur and opaque fills, the same as the reduced-transparency fallback). When the device asks for reduced transparency, Solid is the default.
- **Saved:** on the account, alongside the light/dark choice saved today, so it follows the student to every device. A copy on the device applies it before the first paint, so pages never flash the default theme.
- **Not themed:** public marketing pages stay the Cordia default, class colours stay the student's own class covers, and status colours (errors, warnings) never change.

## 4. Screens

### 4.1 Home (`screens/1-home.html`)

The home is an empty chat, like ChatGPT and Claude: nothing but a headline, the composer and up to three suggestions, centered in the space between the sidebar and the rail.

- Top bar, 52px: an "All classes" picker (quiet button with chevron) at the left; today's date at the right in 13px muted.
- The column sits a little above the vertical middle, 760px wide, 20px between its parts.
- Headline in Newsreader 40/600: "<Weekday> is your <class name> exam." when an exam with a review set is within 7 days ("Tomorrow" and "Today" when they apply). Under it, 17px muted: "<N> ideas left to master. <K> today keeps you on pace.", where K is the number Learn's pacing gives for today. With no such exam: "What are you studying?" and no second line.
- The composer (4.2).
- Under it, up to three suggestion pills (40px, `glass-inner`, 18px icon, 15/600 label), in this order when they exist: "Start Learn for <exam>" (opens Learn on the review set), "Review flashcards (<N> due)" (opens Study now capped at 50 cards), "Plan <class>'s <next Canvas deadline, in plain words>" (opens its assignment sheet; for example "Plan EH 101's Packback discussion"). Pills with nothing behind them are left out; with none, the row is hidden.
- At the bottom of the page, 13px muted, centered: "The Tutor answers from your class material. Check anything that matters before you rely on it."
- When the student sends a message, the home becomes a chat (4.3): the headline and suggestions go, the message appears, and the composer moves to the bottom.

### 4.2 Composer

- `glass-fill-strong`, 28px corners, 12px padding. On focus, a 2px `focus-ring` outline around the whole composer, not the text box.
- No tool chips: tools live in the rail (3.4). The Tutor reads intent from the message ("quiz me on 4.3", "make a guide from this") and can still open any tool.
- Message box: 17px/500 at 1.5, borderless, placeholder "Ask the Tutor, or drop in slides, a PDF or a lecture", 88px tall on the home and 52px in a chat, growing to 8 lines.
- Bottom row: attach (paperclip) and voice (mic) icon buttons, the class picker (dot, code, chevron), then Send at the right (40px round; quiet `ink` 7% until there is something to send, then olive glass, arrow-up icon).

### 4.3 Chat with a tool pane (`screens/2-chat-with-tool-pane.html`)

- The chat column: a 52px header (chat title at 17/600, the class chip, a ⋯ menu), then messages, then the composer. With no pane open, the messages and composer are centered at 760px, like ChatGPT; with a pane open, the chat takes at least 400px on the left and the pane sits between it and the rail.
- Student messages: `glass-fill-strong` bubbles at the right, 20px corners with a 6px bottom-right corner, at most 78% of the column.
- Tutor messages: no bubble. A 32px round glass avatar with the mark, then text at 17px/1.55.
- Tool card in a reply: a glass row (16px corners) with a 40px selected-glass tile and the tool's icon in `olive`, the title "<Tool> · <set>" at 17/600, a 13px line with counts and "open beside this chat", and a 1.5px olive ring while its pane is open. Clicking it opens or focuses the pane.
- Suggested follow-ups under a reply are chips (Give me a hint, Switch to Learn, and so on).
- The pane: `glass-fill-strong`, 28px corners, 16px × 20px padding. The header has the tool tile, the tool name at 20/600, "<set> · <class>" in 13px muted, progress at the right in tabular 13px muted ("Problem 2 of 10"), then full screen and close (40px icon buttons). Under it, a 4px segmented progress bar (done `olive`, current `olive` 45%, rest `ink` 8%). The Practice board keeps `draw-paper` and the existing board tools, laid on a floating glass toolbar at the bottom left, with Tidy at the bottom right.

### 4.4 Class page (`screens/3-class-page.html`)

- Header: a 56px cover tile (16px corners, the class's wash and icon), the class name in Newsreader 40/600, "<CODE> · synced from Canvas <time> ago" in 13px muted, and the sharing button and ⋯ at the right.
- The class composer, then two columns: the tabs and list (flex 2, at least 520px) and the exam aside (flex 1, at least 300px). They stack below 900px.
- Tabs are the brand's segmented control. Guide rows follow 4.1's row spec, with a 120 × 6px mastery bar (mastered `olive`, familiar `olive` 45%, learning `olive` 16%, new `ink` 8%) above "N of M mastered".
- The exam card is `glass-fill-strong`, 28px corners, 24px padding: "Exam 3" in Newsreader 28/600, the date line, the 112px ring beside the pace sentence, then "Start today's N" (olive, 44px) and "Timed practice test" (glass, 44px).

### 4.5 Learn in the shell (`screens/4-learn-in-shell.html`)

- A 64px top row: a quiet back button with the set's name, the class dot and code, and at the right "Round 3 · question 4 of 7" with seven 10px dots (done `olive`, current ringed, rest `ink` 12%) and an end-round button.
- The card is `glass-fill-strong`, 28px corners, 28px padding: the level as a selected-glass pill ("Familiar"), the source line, the question at 22/600, the answer field (17px, `lg-fill-field`), then "How sure are you?" with Sure, Think so and Guess as a segmented control, and "I don't know" (quiet) and "Check" (olive) at the right.
- Under the card: the readiness ring with "77% ready · exam Thursday · 30 ideas left", and the Ways to learn chips at the right.
- "Ask the Tutor about this" sits at the bottom right as a glass button.

### 4.6 Make it yours (`screens/5-make-it-yours.html`)

- Header: "Make it yours" in Newsreader 30/600, then 15px muted "Changes show up everywhere as you pick them, on every device you sign in to." A 40px close button at the right.
- Rows split by hairlines: a 184px label column (15/700, with an optional 13px muted hint under it) and the controls.
- Theme tiles: 6 across, each a mini window (sidebar strip, accent bar, a line) on its background, name under it. Background and font tiles are 92px wide. Chosen tiles get a 2px accent ring with a 5px soft halo. Hover lifts unchosen tiles 1px.
- Text size, Appearance and Glass use the segmented control.
- Footer above a hairline: "Reset to Cordia" (quiet) at the left, Done (accent glass) at the right.

### 4.7 Phones (design B, "chat first"; `screens/iphone-b-chat-first.png`)

Under 768px with the new shell on. No tab bar.

- **Top bar:** 52px. Home: ☰ (44px) at the left, the class pill picker ("All classes" or the course code) in the middle, New chat (44px) at the right. Other pages: a back arrow instead of ☰ and the page title instead of the picker. Content is full width with 12px side margins.
- **Home:** the exam headline and pace line (4.1's copy, wrapped for the width), then swipeable suggestion cards (Start Learn, Review due flashcards, Plan the next deadline) just above the composer. The composer is pinned to the bottom above the home indicator (`env(safe-area-inset-bottom)`), with +, the class picker, voice and Send; it rises with the keyboard and the last message stays visible.
- **Menu drawer:** ☰ or a swipe in from the left edge. About 320px wide, menu glass over a dimmed page (the 22% `ink` scrim). Wordmark, Search, Tools as round buttons in a 4-column grid with More tools, Classes with readiness rings (3.3), Recent chats, the account row. Closes on tap outside, swipe left or Escape; focus is trapped while open.
- **+ sheet:** a bottom sheet with a grab handle; a row of Camera, Photos and Files; then every tool as a large tile with its name, 4 to a row. Closes on swipe down or tap outside.
- **Study screens** (Learn, Flashcards, Quiz, Practice, NCLEX, Study now): full screen, a close button and the progress bar at the top, answer controls within thumb reach at the bottom.
- **Elsewhere:** Calendar shows the Agenda view; Make it yours is a full-height sheet; a tool opened from a chat opens full screen and back returns to the chat.
- Tap targets at least 44px, no sideways scrolling, reduced motion respected, light and dark. With the switch off, phones keep today's layout.

## 5. Copy

- Sentence case everywhere, except the sidebar headings.
- No exclamation marks, greetings or hype words. Buttons are verbs that say what happens.
- Numbers are numerals in tabular figures, with one format per screen: "77%", "30 ideas", "Thu, Nov 19", "11:59 PM".
- Grades are called estimates.
- Sample content in tests and stories uses real-sounding class work, never "Lorem", "Acme" or "John Doe".

## 6. Motion

### 6.1 Everyday

- State changes: 180ms, `cubic-bezier(.2, .8, .2, 1)`, on named properties only (never `transition: all`).
- Hover, only where a pointer can hover: glass buttons and chips rise 1px with a deeper shadow; primary buttons add the 4px olive halo; rows and nav items show `glass-inner`. Nothing changes colour or weight on hover.
- Press: scale 0.97 on buttons and chips.
- Keyboard-driven changes (tabs, arrow keys, ⌘K) show on the next frame with no transition.
- Pages load whole with the breathing mark if data takes over 200ms. No skeletons, no spinners.

### 6.2 Rail popovers

- Hover shows the popover after 300ms (so sweeping the pointer down the rail doesn't flash every one) and keeps it while the pointer is on the button. Moving straight to the next button shows the next one at once.
- Enter: opacity 0 → 1 and 6px from the right to rest, 150ms, ease-out. Exit: 100ms fade.
- Keyboard focus shows it immediately; Escape hides it.
- Reduced motion: it appears and disappears with no movement.

### 6.3 The tool pane

```
/* 0ms: the tool card's ring turns on · 0ms: the pane starts 16px right, opacity 0 · 240ms: settled */
const PANE = { enterMs: 240, exitMs: 180, distancePx: 16, ease: 'cubic-bezier(.32, .72, 0, 1)' };
```

- Enter: from 16px to the right and opacity 0 to rest, 240ms, ease-out `cubic-bezier(.32, .72, 0, 1)`. The chat column narrows over the same 240ms.
- Exit: 180ms, back 16px and fading, then the chat widens.
- The pane is interruptible: closing it mid-enter reverses from where it is.
- While closed it is unmounted or `inert`, so it can't take focus or clicks.
- Focus moves into the pane's heading when it opens and back to the tool card when it closes.
- Reduced motion: the pane appears and disappears with no movement or fade; the chat column snaps to its new width.

### 6.4 Never

Looping pulses on things that aren't live, shimmer on text, parallax, sections fading in on scroll, confetti outside a strong finish to a session.
