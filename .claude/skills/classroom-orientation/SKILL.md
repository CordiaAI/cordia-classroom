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

## Study styles (learning styles, added 2026-09-26)
- Student picks a VARK style (`learning_preferences` table); per-question aids cached in `study_aids`. Code: `backend/services/learning_styles.py`, `backend/routers/learning.py`, `web/components/StudyAidPanel.js`.
- Off switch: backend env `LEARNING_STYLES_ENABLED=false` (hides UI, Tutor unchanged). No style chosen = today's behavior.
- Rules: styles never change the saved guide text, facts, or NCLEX/exam formats; never label the student; Mermaid is always built server-side from validated nodes and rendered with `securityLevel: 'strict'`.
- Next (release 2): stable concept IDs + delayed Retain recall to score Tutor approaches (+1/0/−1) within the chosen style.

## State snapshot (2026-09-26 — refresh when stale)
- Work lands mostly as direct commits to `main` (recent revert pairs for visual redesigns).
- Draft PR #23 (`claude/wonderful-faraday-1dp3p2`, drop legacy autostudyai.online CORS) is 12 behind; rebase before merging or its diff reverts newer main work.
- `feat/classroom-production-readiness` has 13 unique unmerged commits (RLS hardening, Tutor grounding, provenance) — likely superseded partly; needs owner decision.
- `master` is a stale May 2026 branch (2 unique commits); everything else is merged → safe to delete.
