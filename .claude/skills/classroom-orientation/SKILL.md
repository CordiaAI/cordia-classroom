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

## Layout
- `extension/` — MV3 extension (`content.js`, `background.js`, `popup.js`, `asai-bridge.js`, `vendor/Readability.js`).
- `pptx-bundle/pptx-parser.js` — locked PPTX parser bundle; `backend/services/pptx_rendering.py` renders PPTX server-side.
- `backend/` — FastAPI on Fly (`main.py`, `routers/*`, `services/llm.py`, `services/text_processing.py`, `domains/*.json`).
- `web/` — Next.js pages router (Vercel auto-deploy on push to main).
- **Deploying the backend from a cloud session:** install flyctl (`curl -sL https://fly.io/install.sh | sh`, then `export PATH=/root/.fly/bin:$PATH`), then `cd backend && flyctl deploy --remote-only --depot=false`. Plain `fly deploy` fails here because the proxy breaks the default Depot builder's TLS. `FLY_API_TOKEN` is already in the env. Verify with `flyctl logs --no-tail` and a 200 from https://autostudy-ai.fly.dev/.
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
