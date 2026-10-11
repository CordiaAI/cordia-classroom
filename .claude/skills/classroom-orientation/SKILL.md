---
name: classroom-orientation
description: Use at the start of any CordiaClassroom (AutoStudyai repo) coding session to get current layout, how to run CI checks locally, branch hygiene, and known drift. Update the "State snapshot" section whenever it goes stale.
---

# CordiaClassroom orientation

`CLAUDE.md` owns the rules (pipeline tracing, prompt rules, locked slideshow capture, `fly deploy`). `PRODUCTION_RELEASE_PLAN.md` owns release priorities. This skill is the operational map.

## Talking to the owner (Jackson)
- Jackson doesn't write code or use git terms; Claude/Codex write the code, Jackson prompts and tests. Explain in plain language: "the live version" not "main", "saved changes" not "commits", "old draft copies" not "stale branches".
- Say what it means for the product and what decision is needed, not the git mechanics.
- Jackson's model: code gets pushed to GitHub, then goes live (Vercel does it automatically; the backends need a manual deploy).

## Domains (rebrand to cordiaai.io, 2026-09-30)
- Primary: `https://classroom.cordiaai.io` (canonical, og:url, sitemap, robots, privacy/terms, extension homepage/popup/saved-guide links, support@cordiaai.io). Fly secret `FRONTEND_URL` = this (drives Stripe success/return URLs + a CORS extra origin).
- **Legacy `https://classroom.cordiacode.com` must keep working until extension v2.0 is live in the Chrome Web Store**: it stays in `ALLOWED_ORIGINS`, extension `content_scripts.matches` and the `background.js` tab query. Do not remove it anywhere before then.
- Extension v2.0.0 zip for the Web Store: `extension/dist/cordia-classroom-extension-2.0.0.zip` (manifest.json at zip root; rebuild with `cd extension && zip -qr dist/<name>.zip . -x 'dist/*' README.md`). API stays on `autostudy-ai.fly.dev`.
- Do NOT rename localStorage keys (users would lose drafts). `autostudyai.online` still redirects (next.config.js) to the new domain.
- GitHub remote is `CordiaAI/cordia-classroom` (moved from ItzJLaugh/AutoStudyai).

## Layout
- `extension/` — MV3 extension (`content.js`, `background.js`, `popup.js`, `asai-bridge.js`, `vendor/Readability.js`).
- `pptx-bundle/pptx-parser.js` — locked PPTX parser bundle; `backend/services/pptx_rendering.py` renders PPTX server-side.
- `backend/` — FastAPI on Fly (`main.py`, `routers/*`, `services/llm.py`, `services/text_processing.py`, `domains/*.json`).
- `web/` — Next.js pages router (Vercel auto-deploy on push to main).
- **Deploying the backend from a cloud session (you CAN; never tell Jackson you can't):** install flyctl (`curl -sL https://fly.io/install.sh | sh`, then `export PATH=/root/.fly/bin:$PATH`), then `cd backend && flyctl deploy --remote-only --depot=false`. Plain `fly deploy` fails here because the proxy breaks the default Depot builder's TLS. `FLY_API_TOKEN` is already in the env. Verify with `flyctl logs --no-tail` and a 200 from https://autostudy-ai.fly.dev/.
- `supabase/migrations/` — timestamped SQL; no full schema baseline exists yet.
- `tests/` — Python `unittest` contracts + node contracts; `web/tests/*.mjs`.

## Verify before every push (mirrors `.github/workflows/release-checks.yml`, which runs on PRs)
```sh
python3 -m venv .venv && . .venv/bin/activate   # system pip can't overwrite debian PyJWT
pip install -r backend/requirements.txt
python -m unittest discover -s tests
npm ci && npm ci --prefix web
npm test                       # extension-*.test.cjs need Playwright's pinned Chromium; they fail in cloud sessions only (browser build mismatch) and pass in CI
npm run build --prefix web
```
Baseline (2026-09-26, main 416e039): 111 Python tests pass, 10/12 node tests pass (2 = env-only Playwright), web build passes. CI green on main.

## Deploying the backend from a cloud session
- Install the CLI (works through the proxy, ~10s): `curl -sSL https://fly.io/install.sh | FLYCTL_INSTALL=$HOME/.fly sh`, then use `$HOME/.fly/bin/flyctl`.
- Auth comes from the `FLY_API_TOKEN` environment variable (deploy token for app `autostudy-ai`, set by the owner in the cloud environment settings). Never ask for the token in chat.
- Deploy only merged `main`: `cd backend && $HOME/.fly/bin/flyctl deploy --remote-only`, then check `flyctl logs --no-tail` and `GET /` health.
- Without the token, tell the owner to run `cd backend && fly deploy` on their computer.

## Study styles (learning styles, added 2026-09-26)
- Student picks a VARK style (`learning_preferences` table); per-question aids cached in `study_aids`. Code: `backend/services/learning_styles.py`, `backend/routers/learning.py`, `web/components/StudyAidPanel.js`.
- Off switch: backend env `LEARNING_STYLES_ENABLED=false` (hides UI, Tutor unchanged). No style chosen = today's behavior.
- Rules: styles never change the saved guide text, facts, or NCLEX/exam formats; never label the student; Mermaid is always built server-side from validated nodes and rendered with `securityLevel: 'strict'`.
- Next (release 2): stable concept IDs + delayed Retain recall to score Tutor approaches (+1/0/−1) within the chosen style.

## Practice problems (owner direction, 2026-09-27)
- Two steps: `classify_practice_area` picks an area from `backend/services/practice_areas.py`, then `generate_verified_practice_set` generates 10 problems with that area's system prompt. New area = new dict entry.
- The model **interprets** the material. Never gate problems on word-for-word citation matching; Jackson rejected that ("no production app does verbatim match"). Only numeric answers get a deterministic recompute, and a mismatch downgrades to "reference", never drops the item.

- The model's `answer` can disagree with its own worked solution (54 vs 45). `validate_practice_set` rewrites the answer to the recomputed value when the expression agrees with the key or the solution's result. Saved sets keep old data: fixes need "Regenerate questions".

## Study guide questions (owner direction, 2026-09-28)
- Every Q must stand alone: never "What is the task in Problem 4?" or "Slide 5". Worked examples/practice problems become "how do you apply the method" questions (rule in `_build_study_guide_prompt`, next to the assignments rule it narrows).
- A generation fix can't be verified from a cloud session (no OpenAI key; running code on Fly via ssh is blocked). Say so and ask Jackson to regenerate the guide.

## OpenAI models (owner decision, 2026-09-28)
- Uses gpt-4o and gpt-4o-mini only. OpenAI data sharing is OFF (Jackson turned it off), so all tokens are billed.
- Switching to gpt-5-mini/nano was proposed and deferred: "don't change what's working". Needs temperature/max_tokens changes and a real quality check Jackson must run. Don't raise it again unless cost or quality comes up.

## Backend rules learned in production (2026-09-27)
- One uvicorn worker, 1 CPU: an `async def` route that calls OpenAI/Supabase/parsing synchronously freezes every other request. Use plain `def` (FastAPI threads it) or `run_in_threadpool`.
- Parse model JSON with `response_format={"type": "json_object"}` or `_loads_model_json`; math guides contain LaTeX backslashes that break plain `json.loads`.
- Dates shown to users must use the client's `tz_offset`; server `date.today()` is UTC.
- Schema drift check: compare code `.select/.eq/insert` columns against `information_schema.columns` (Supabase MCP) whenever a route 500s with `42703`.

## Extension capture rules (audit 2026-09-27)
- Capture order in `extension/content.js`: selection → embedded document (iframe/embed/object, or the tab itself) → page text if ≥400 chars → linked document (nav/header/footer links ignored). Text reading walks open shadow roots and same-origin frames; `background.js` adds cross-origin frame text for thin pages.
- Any capture change must pass `tests/extension-capture-matrix.test.cjs` (real extension, 13 LMS-shaped pages). In cloud sessions run it with `executablePath: '/opt/pw-browsers/chromium'` and `--headless=new` (CI uses `channel: 'chromium'`).
- A document the extension found but can't use must error clearly, never silently become a screenshot. Scanned PDFs are OCR'd server-side (`transcribe_document_pages`).
- Bump `extension/manifest.json` version and `tests/extension-load.test.cjs` together; Web Store upload is a zip with `manifest.json` at the root.

## State snapshot (2026-09-26 — refresh when stale)
- Work lands mostly as direct commits to `main` (recent revert pairs for visual redesigns).
- Draft PR #23 (`claude/wonderful-faraday-1dp3p2`, drop legacy autostudyai.online CORS) is 12 behind; rebase before merging or its diff reverts newer main work.
- `feat/classroom-production-readiness` has 13 unique unmerged commits (RLS hardening, Tutor grounding, provenance) — likely superseded partly; needs owner decision.
- `master` is a stale May 2026 branch (2 unique commits); everything else is merged → safe to delete.

## Feedback round decisions (owner, 2026-10-05)
- Uploads: drop anywhere on the page, but route to the right upload box (olive-dark outline on the box while dragging). Unsupported types (zip, video until built) show a clear "not supported" message.
- Multi-file: max 5 files, Create + Tutor only (SmartNotes viewer stays one file). After upload, a "select files you want to combine into a study guide" picker repeats until every file is used. Respect the model's context window; never silently truncate.
- Create page = two windows (manual text | file drop). If both filled, ask whether to include the manual text with the file guide. Generation keeps running while the user browses; small infinity-logo loader top-right.
- Top bar on every page, next to profile: "Install Classroom SideBar" button (black/grey + dark-olive layered wave around the outline), hidden when the extension is installed; links to https://chromewebstore.google.com/detail/cordiaclassroom (owner confirmed this link). Profile-menu "Chrome extension" item goes away.
- Canvas: the ICS feed has no completion data. Owner wants the fewest student steps; the extension (already `<all_urls>`) can read Canvas planner/to-do status with the student's own logged-in session. Due-today items glow yellow (grid + list); left list becomes an auto-checked to-do list; checked items dissolve with a 5s undo.
- Quizlet import: dropped by owner — do not raise again until they bring it back.
- Page-wide drag and drop lives in `web/lib/fileDrop.js` (`useFileDropZone`, `unsupportedFileMessage`). Drop under the pointer wins; otherwise highest priority (page box = 2, Tutor = 1, Tutor opens itself). Reuse it for any new upload box instead of adding onDrop handlers.
- Context limits to respect in UI: `/generate` keeps 500,000 chars (`MAX_CONTENT_LENGTH`, sliced silently server-side), Tutor model reads `context[:25000]`. Create blocks over-limit combos; Tutor splits 25k fairly across attachments and says what was trimmed.
- Local browser smoke tests: build, `setsid npx next start -p <port>`, set a fake JWT in `localStorage.authToken`, route API calls with Playwright, simulate real file drops with CDP `Input.dispatchDragEvent`. Never `pkill -f "next start"` in a command that contains that text (kills your own shell); use `pkill -f next-server`.
- Install button: `web/components/InstallSidebarButton.js` in the top bar (Sidebar.js), hidden via `data-asai-extension="ready"` / `ASAI_EXTENSION_READY`. All install links use `EXTENSION_STORE_URL` in `web/lib/extension.js` (ID-based listing, v2.1.0); the short `/detail/cordiaclassroom` link only opens the store home page.
- Tutor (`AIChatWidget`) lives in Layout and never unmounts on client navigation: any list it loads must refresh on `routeChangeComplete`/focus, or new guides/notes stay invisible until a full reload (bug fixed 2026-10-07).
- Create page (2026-10-07): two windows (Manual Study Guide | Upload Files + paste), one Create button on top; both filled → "include manual cards?" choice. AI guides run as background jobs (`web/lib/guideJobs.js`, `GuideJobIndicator` in Layout, small infinity loader top-right); Create auto-opens the result only if the student is still on an idle Create page.
- Canvas auto mark-off (point 4): owner DECLINED the extension-reads-Canvas design (2026-10-07) and is rethinking it. Don't build Canvas sync, token minting, or extension changes for it until the owner brings a new plan.

## Tutor has two front ends (2026-10-08)
- Web Tutor = `web/components/AIChatWidget.js` (+ `web/lib/tutorFormat.mjs` renderer); extension Tutor = `extension/tutor-chat.js`. Both call `/chat` → `answer_question` in `backend/services/llm.py`. A Tutor UX or answer-format change must land in BOTH, or the owner will see it only in one (the Oct 1 readable-answer work shipped extension-only).
- Readable answers require `rich_text: true` in the request; the backend's `RICH_TEXT_FORMAT` only applies then.
- The web widget polls `/tutor/session`; never let a poll overwrite local state while a `/chat` request is in flight (`sendingRef`), or the student's message vanishes until the reply lands.
- Study Guides page (`dashboard.js` view=guides, 2026-10-11): class tile grid removed; two boxes — "Classes" (collapsible class rows with their guides, drag a guide onto a class to move it) and "Not in a class" (unsorted guides; drop here to remove from a class). Class open/closed state in `localStorage.cordiaOpenClasses`. `.guide-row` is already taken by another page's CSS; the library rows use `.library-guide-row`.

## Open production gaps (code review 2026-10-11; remove each line once fixed)
- Fixed 2026-10-11: list screens use `GET /guides?fields=summary` (no guide text, `flashcard_count`, limit up to 500); GZip on; `/practice` sync; beacon DB work in a thread; SmartNotes HTML goes through `web/lib/sanitizeHtml.js`. Use `fields=summary` for any new list screen.
- CORS allows any `https://*.vercel.app` and any `chrome-extension://` origin with credentials; narrow to this project's preview pattern and the extension ID.
- AI routes in routers (exam, nclex, quiz, learning, smart_notes) have allowance checks but no rate limit; exam/nclex/quiz "generate" are GET requests that spend tokens.
