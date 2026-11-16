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
| `glass-fill` | `rgba(248, 250, 247, 0.46)` | `rgba(42, 46, 51, 0.52)` | Resting panes: sidebar, cards, Up next, chips' parent |
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

- The page has 12px padding. The sidebar floats at the left, 264px wide, with 24px corners; content starts 12px to its right.
- Content tops out at the widths in the screens: the home column is 760px wide, the Learn card 780px, the class page fills the remaining width.
- 1440 × 900 is the reference size. Nothing on the home, chat, class or Learn screens scrolls at that size, except the chat's own message list and the tool pane's body.

### 3.2 Sidebar

From the top, with 14px between groups:

- Brand row: the mark at 30 × 26, "cordia" in Newsreader 20/600, and the fold toggle (36px).
- New chat: full width, 44px, olive glass, square-pen icon. Search below it, 38px, with a ⌘K keycap at the right (12px/600 muted on a 1px hairline ring).
- "TOOLS" heading (the brand's one uppercase style: 12px/700, 0.06em, muted), then Library (book-open), Learn (graduation-cap), Flashcards (layers), Quiz (list-checks), Practice (pencil-line), Calendar (calendar), each 38px, then "More tools" (ellipsis, muted label, 36px).
- "CLASSES" heading with a 32px + button, then classes at 36px: a 10px dot in the class's `cover-ink-N`, the course code at 14px/600, and, at the right, the readiness % in tabular 13px muted and a 16px ring (2.25px stroke).
- "RECENT CHATS" heading, then chat titles at 36px, 14px/500, one line with an ellipsis.
- Account row at the bottom, above one hairline: a 36px avatar (initials in `olive-ink` on selected glass), the name at 14px/600, the plan and school at 12px muted, and a ⋯ button.
- Hover: `glass-inner` with a white inset top line. Current: `selected-glass` with an `olive` icon. Folded: 72px of icons.

### 3.3 Readiness ring

- The readiness % is Learn's own number (Mastered counts fully, Familiar half, Learning a little) for the review set tied to the class's next exam.
- The ring track is `ink` at 12%; the arc is `olive`, round-capped, starting at 12 o'clock and going clockwise.
- Sizes: 16px in the sidebar, 36px on list rows, 112px on the exam card (8px stroke, the % inside in Newsreader 34/600 tabular).
- The ring has an accessible label: "77% ready for the next exam". With no upcoming exam, there is no ring and no empty placeholder.

## 4. Screens

### 4.1 Home (`screens/1-home.html`)

- Top bar, 52px: an "All classes" picker (quiet button with chevron) at the left; today's date at the right in 13px muted.
- The column sits in the vertical middle of the remaining space, 20px between its parts.
- Headline in Newsreader 40/600: "<Weekday> is your <class name> exam." when an exam with a review set is within 7 days ("Tomorrow" and "Today" when they apply). Under it, 17px muted: "<N> ideas left to master. <K> today keeps you on pace.", where K is the number Learn's pacing gives for today. With no such exam: "What are you studying?" and no second line.
- The composer (4.2), then Up next: one glass list (20px corners, 8px padding), rows 16px × 20px padding, each with a 40px lead (ring or icon tile), a 17/600 title, a 13px muted line, and a 36px glass button.
- Under everything, 13px muted, centered: "The Tutor answers from your class material. Check anything that matters before you rely on it."

### 4.2 Composer

- `glass-fill-strong`, 28px corners, 12px padding. On focus, a 2px `focus-ring` outline around the whole composer, not the text box.
- Chips: 40px pills on `glass-inner`, 18px icons, 15px/600 labels. Pressed: `selected-glass` with an `olive` icon and a 0.5px olive ring.
- Placeholders: none chosen, "Ask the Tutor, or drop in slides, a PDF or a lecture"; Make guide, "Paste text, a link, or drop slides and PDFs here"; Learn, "Learn which set? Try “Exam 3 review, test Thursday”"; Flashcards, "Review due cards, or name a guide"; Quiz, "Quiz me on… Try “4.3, ten questions”"; Practice, "What should we practice? Try “related rates, 10 problems”"; Plan, "What’s coming up? Try “plan my week”".
- Message box: 17px/500 at 1.5, borderless, 88px tall on the home and 52px elsewhere, growing to 8 lines.
- Bottom row: attach (paperclip) and voice (mic) icon buttons, the class picker (dot, code, chevron), then Send at the right (40px round; quiet `ink` 7% until there is something to send, then olive glass, arrow-up icon).

### 4.3 Chat with a tool pane (`screens/2-chat-with-tool-pane.html`)

- The chat column: a 52px header (chat title at 17/600, the class chip, a ⋯ menu), then messages, then the composer with the active tool's chip pressed.
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

### 6.2 The tool pane

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

### 6.3 Never

Looping pulses on things that aren't live, shimmer on text, parallax, sections fading in on scroll, confetti outside a strong finish to a session.
