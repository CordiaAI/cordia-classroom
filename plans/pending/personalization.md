# Cordia personalization system: phased plan

Status: **APPROVED Nov 4, 2026**, with the owner's answers recorded in the decision log (Q1–Q18).
Phase 0 is in progress. Migrations stay files; the owner applies them.
Inputs: `Cordia-Classroom-Brief.md` (Oct 29, 2026; §21 streams, §22 engine, §23 working rules), the
personalization planning prompt (resolved decisions copied into the decision log below), the code at
`main@adc88da`, read-only queries against the live Supabase project, and the eleven research reports in
`docs/research/01…11`.

> **Reports.** The brief and the eleven reports are in the repo since Nov 5 (`Cordia-Classroom-Brief.md`,
> `docs/research/01…11`). Every item this plan first deferred as "read at pickup" is now filled in
> from them, with the report and section cited. Where the reports disagree with each other or with a
> resolved decision, the decision stands and the conflict is listed under **What the reports change**.

---

## What the code says (changes to the prompt's assumptions)

1. **Phase 0 is half built and already live.**
   - These tables exist in production with rows: `learning_events` (46 rows), `decision_events` (7),
     `policy_versions` (1, `format-rules-v0`) and `learner_settings` (0).
     They come from `supabase/migrations/20261030120000_learning_events.sql`. Its header says "NOT
     APPLIED", but the tables exist live.
   - Answers are logged from Learn, Timed test, Quiz and Check yourself (mode `check`), Match,
     Flashcards (`flashcards/study`), Study now, NCLEX practice and Practice. Explain views are logged as
     `view_shown`.
   - Server-side `same_day` already means "not the first try of the local day"
     (`backend/services/learning_events.py:73-88`). `is_first_try_today` is therefore `NOT same_day`, so
     no new column is needed.
   - Gaps to close:
     - `n_options` is not logged.
     - `rapid_guess` is always false.
     - `fsrs_rating`, `s/d/r_before` and `fsrs_before` are always null. This is expected until Phase 2.
     - Flashcards in `play/[guideId]` are not logged.
     - There is no `decision_outcomes` table: `decision_events` plays the role of `policy_decisions`.
     - `logFormatDecision` always writes `propensity: 1`, `seed: 0`.
     - No recall-activation metric exists.
2. **The live schema is ahead of the repo.**
   - Supabase's migration history stops at `20261004 retain_question_types`, yet every later table
     exists, including ten files still headed "NOT APPLIED".
   - Five applied migrations have no file in the repo: `simplify_free_plan_limits`,
     `revoke_execute_handle_new_user`, `grant_handle_new_user_to_auth_admin`, `admin_user_overview`,
     `assistant_links`.
   - The core tables have no create statement anywhere: `user_profiles`, `study_guides`,
     `study_sessions`, `quiz_attempts`, `user_streaks`, `folders`, `smart_notes`.
   - Every new migration in this plan therefore starts from a captured baseline (step 0.1).
3. **Scheduling runs as JavaScript in three places, not in the backend.**
   - Leitner (`web/lib/spacedReview.mjs`), Learn levels and the 5-day fade (`web/lib/learnEngine.mjs`),
     and the Retain re-correct rule (`web/lib/retainEngine.mjs`) all run in the browser.
   - The MCP server reuses them (`web/lib/studyAnswer.mjs`).
   - The Assistant keeps its own copy of the fade and the fingerprint
     (`cordiaassistant/lib/reminders/exam-prep.ts`). Its streak ignores the weekly freeze
     (`plan-streak.ts`).
   - Writes go browser → Supabase RPC `merge_study_progress` (student token), and MCP →
     `mcp_record_answer`. No backend Python touches scheduling.
   - Putting FSRS in `py-fsrs` (as first locked) would have sent every answer write through the
     backend. **Q9 resolved:** ts-fsrs, extracted with the existing schedulers into one shared package
     used by the web app, the MCP server and the Assistant, so there is a single copy.
4. **Onboarding already has the right skeleton.**
   - The day-one walkthrough (`web/lib/walkthrough.js`) runs: New → About you (level, school, 10 major
     chips) during the build → 3 multiple-choice questions → "Your first review is tomorrow".
   - Check yourself on a new guide is separate: `CHECK_COUNT = 5`, multiple choice only
     (`web/lib/checkYourself.js`). Its confidence is logged to `learning_events` but not to
     `quiz_attempts`.
   - There is no reveal, no plan and no exam-date question.
   - `onboarding_progress.step`'s database check rejects two steps the backend allows (`first_guide`,
     `unlocked`; `backend/routers/learning.py:42`). This is a latent bug.
5. **The Dashboard has no "Next session" or Study now entry.**
   - Study now (`/session`) is reachable only from a guide.
   - The Exam countdown card exists (`web/lib/examCountdown.mjs`, 0–14 days).
6. **Grades are thin.**
   - Canvas sync stores `score`, `current_score` and `is_exam` (title regex,
     `backend/routers/canvas.py:158`).
   - It does not request `score_statistics`; the allowlist in `backend/services/canvas_client.py:274-289`
     has no such include.
   - There is no manual or screenshot grade entry.
7. **SMS lives in another repo.**
   - The Assistant (`cordiaai/cordiaassistant`, Twilio) sends every text; this repo sends none. Quiet
     hours (21–08 hard floor), STOP/PAUSE/LESS and `canSend()` are there.
   - Every SMS step in this plan is an Assistant-repo change, which this session can't push without
     adding that repo (**Q16**).
8. **The learning-style setting today is VARK.**
   - It uses a 5-option picker in Settings › Tutor (`LearningStylePicker.js`), shapes Tutor replies and
     the first Explain view, and is gated by `LEARNING_STYLES_ENABLED` (default on).
   - A separate free-text field, "How do you like things explained", lives in
     `learning_preferences.explain_preference`.
   - `learner_settings` has a matching column for the explain-first choice (`first_view_pref`) and for
     the old "How do you like to study?" answer (`study_preference`). Neither is used.

---

## What the reports change (Nov 5)

Filled in from the reports:
- **`decision_outcomes`** (report 08 "Core schema"): `decision_id, outcome_type (delayed_recall |
  returned_within_48h | sms_converted_2h), value, p_pred, residual, observed_at`. `p_pred` and
  `residual` (y − p̂) stay null until FSRS predicts recall (Phase 2).
- **Activation** (report 09 §Metrics): within 24 h of signup, (a) made a guide, (b) answered ≥3 recall
  questions, (c) saved an exam date. **D1/D7 return**: any study session on day 1 / within days 6–8.
- **Recall formats** (report 01 rule 4, report 08 mapping, brief §5.1): typed, fill, written.
  Flashcard flips and multiple choice/match are recognition: they count for D1/D7 return but not as
  recall answers for activation or Mastered. (The first draft wrongly listed flashcards as recall.)
- **Onboarding questions** (report 10 "Recommended First-Week Sequencing") and **drip days 2–7**, with
  wording, now in steps 1.3 and 1.7. First name is not a report-10 question: it stays prefilled from
  sign-in, never asked.
- **Quick Check** (report 06 §A–D), **plan rules** (report 01 rules 7–28), **NCLEX-RN 2026 weights**
  (report 05), **consent texts A, B, D, G** (report 11), **per-test outcome fields and tiers**
  (report 07) are in their steps below.

Not in any report:
- **A rapid-guess threshold.** No report gives one. Report 11 says response-time inferences may count
  as consumer health data under Washington's MHMDA (unsettled). So `rapid_guess` stays false and is
  dropped from Phase 0; latency is still logged as `submit_ms`.
- **A BKT learn (transit) rate.** Quick Check is a single sitting, so it uses none (static BKT with
  report 06's guess/slip).
- **The four Mini-IPIP conscientiousness items' exact wording**: taken from the Assistant's code.

Where the reports disagree with a resolved decision (the decision stands; listed so it's visible):
- **FSRS library (Q9/Q2):** report 08 recommends py-fsrs and notes "ts-fsrs 6 ships" FSRS-7. Step 2.1
  pins the newest ts-fsrs release that is ≥2 weeks old *and* runs 21-parameter FSRS-6 (FSRS-7 is not
  used).
- **Correct + Guess:** report 08 → Hard (plan), report 01 → a miss, report 06 → no credit. Second-gate
  question G1.
- **Experiment design (Q14):** report 09 recommends 50/50 with a Bayesian ship rule plus a separate
  holdout. The owner chose 80/20 directional. Report 11's rule is met: the holdout keeps every study
  feature; only the onboarding differs.
- **Onboarding time budget:** report 09 allows 3 questions in 45–60 s during the build; report 10 says
  the whole onboarding takes under 2 minutes and asks 7 items. Second-gate question G2.
- **Exam path order (Q7):** report 05 says LSAT → bar → NCLEX; reports 02/04 say MCAT/CPA after
  NCLEX. LSAT next stands (owner).
- **ACT/high school, LTI 1.3, anxiety question:** reports 02/05/10 propose ACT, reports 03/07 an LTI
  route, report 10 an opt-in anxiety item. All stay out (Never list).
- **Number of templates:** report 02 has nine archetypes; report 04 says ship 4–5. Second-gate G3.
- **Consents:** report 11 lists four (adds "use de-identified data to improve defaults"). Step 6.1 now
  has four.
- **SMS hours:** report 11 example D says 8 a.m.–8 p.m.; the Assistant allows until 9 p.m. The
  stricter 8–8 is used in the opt-in text and the Assistant (step 1.8).
- **Per-user FSRS fitting:** reports 01/08 recommend a Cordia-wide fit at ~2–5k first-try reviews, then
  per-user fits. The Never list now says "not in this plan" instead of "never", and the global fit is
  listed under Not yet specified.
- **The n ≥ 10 rule** comes from report 11 §6 (cited wrongly to report 07 before).

---

## Phases

Order as proposed in the prompt (Q1 confirms it). Sizes: XS ≤1 file, S 2–3, M 4–6, L+ broken down.
Verification commands, as they exist in this repo today:
- `web:test`: `cd web && node --test tests/*.test.mjs`
- `py:test`: `python -m unittest discover -s tests`
- `rls:test`: the RLS/SQL tests driven by `tests/test_oauth_lockdown.py` and friends against local
  Postgres
- `build`: `cd web && npx next build`
- `lockdown`: `supabase/checks/oauth_lockdown.sql` returns 0 rows

Production checks: read-only SQL through the Supabase MCP, given in each step.

### Phase 0: Instrumentation on top of what exists
Verified when:
- the activation report returns a number for the last 30 days' signups;
- every study surface writes events with `n_options` and the right `mode`;
- the live schema is captured in the repo.

Files to touch: `supabase/schema/`, `supabase/migrations/2026110x*`, `backend/services/learning_events.py`,
`backend/routers/learning.py`, `web/lib/learningEvents*.{js,mjs}`, `web/components/{QuizMode,FlashcardViewer,
RetainCards}.js`, `web/pages/play/[guideId].js`, `backend/routers/admin.py`.

#### Step 0.1: Capture the live schema as the baseline (Size: S)
- Acceptance criteria:
  - `supabase/schema/live-2026-11.sql` holds the column/constraint/RLS/function definitions of every
    `public` table, read with read-only catalog queries.
  - Every "NOT APPLIED" header that is in fact live gets a dated line: "Applied by hand before
    2026-11-04 (verified)".
  - The five history-only migrations are listed in `supabase/schema/README.md`.
- Verification command: `rls:test` still green. A read-only diff query shows no repo table missing from
  live.
- Files likely touched: `supabase/schema/live-2026-11.sql`, `supabase/schema/README.md`, migration
  headers (comments only).
- Test seams: none (documentation). A catalog query is re-run at Phase 2 pickup.
- Blocked by: none

#### Step 0.2: Fill the event gaps (Size: S)
- Acceptance criteria:
  - `n_options` is logged for choice and match items (null otherwise). `rapid_guess` stays false: no
    report gives a threshold, and report 11 flags latency inferences under MHMDA.
  - `play/[guideId]` flashcards log events.
  - Check yourself logs `mode='check'` with confidence (already the case), and `quiz_attempts` gains
    no new column.
- Verification command: `py:test`, `web:test`. In production, `select mode, count(*), count(n_options)
  from learning_events where occurred_at > now()-interval '1 day' group by 1`.
- Files likely touched: migration `20261105120000_learning_events_n_options.sql`,
  `backend/services/learning_events.py`, `backend/routers/learning.py` (schema),
  `web/lib/learningEvents.mjs`, `web/components/QuizMode.js`, `web/pages/play/[guideId].js`.
- Test seams: `tests/test_learning_events.py`, `web/tests/learning-events.test.mjs`.
- Blocked by: 0.1

#### Step 0.3: Decision outcomes and honest propensities (Size: S)
- Acceptance criteria:
  - `decision_outcomes(decision_id, outcome_type, value, p_pred, residual, observed_at)` exists
    (report 08). `outcome_type` is `delayed_recall`, `returned_within_48h` or `sms_converted_2h`.
  - `logFormatDecision` takes `probs`, `propensity` and `seed` from the policy (1/1/0 while rules are
    deterministic), not hard-coded at the call site.
  - A nightly job writes `delayed_recall` (the next first-try recall-format answer on the same idea ≥1
    day later) and `returned_within_48h`. `p_pred`/`residual` stay null until Phase 2.
- Verification command: `py:test`. In production, `select count(*) from decision_outcomes`, nonzero 2
  days after deploy.
- Files likely touched: migration `20261105130000_decision_outcomes.sql`,
  `backend/services/learning_events.py`, `backend/services/sync_worker.py` (nightly hook),
  `web/lib/learningEvents.js`.
- Test seams: `tests/test_learning_events.py` (fake db).
- Blocked by: 0.1

#### Step 0.4: Recall activation and D1/D7 recall return (Size: S)
- Acceptance criteria:
  - Recall activation per report 09: within 24 h of signup, made a guide AND ≥3 recall-format answers
    (typed, fill, written; a correct "Guess" doesn't count, G1) AND an exam date saved (a guide's Learn test date, or a plan's from
    Phase 3).
  - D1 and D7 return per report 09 (any study session on day 1 / days 6–8) are computed alongside it.
  - The figures are admin-only (`/admin/metrics`), by signup week and by experiment arm once 1.1 lands.
- Verification command: `py:test`. In production, the admin endpoint returns rates for the last 30
  days' signups.
- Files likely touched: `backend/routers/admin.py`, `backend/services/metrics.py` (new),
  `tests/test_metrics.py`.
- Test seams: service function over fake rows.
- Blocked by: 0.2

#### Step 0.5: Backfill (Size: S)
- Acceptance criteria:
  - A one-off script writes `learning_events` with `mode='backfill'` from `quiz_attempts.answers`
    (per question, first try, dated `completed_at`).
  - Leitner boxes and Learn levels have no per-answer history, so they are not turned into fake
    events. They are snapshotted for Phase 2 seeding (Q3).
  - The script's dry-run output and SQL are given to the owner; it never runs from here.
- Verification command: `py:test` (script against fake rows). The owner runs it with `--apply`.
- Files likely touched: `backend/scripts/backfill_learning_events.py`,
  `tests/test_backfill_learning_events.py`.
- Test seams: script test.
- Blocked by: 0.2

#### Step 0.6: Confirm active-time only (Size: XS)
- Acceptance criteria:
  - Read-only check: `study_sessions` durations since Oct 30 are capped (≤3 h); no 24 h rows.
  - Metrics in 0.4 use `study_days.minutes` (active) only.
- Verification command: production SQL
  `select max(duration_seconds) from study_sessions where started_at > '2026-10-31'`.
- Files likely touched: none, or `backend/services/metrics.py`.
- Test seams: n/a.
- Blocked by: none

### Phase 1: Onboarding v2 and the reveal
Verified when:
- a new account reaches the reveal with a guide, 3 recall answers and a dated plan in ≤5 min (median,
  QA script);
- the A/B assignment is logged for every signup.

Files to touch: `web/lib/walkthrough.js`, `web/components/{Walkthrough,AboutYou,FirstReview}.js` → new
`Reveal.js`, `web/pages/quiz/[guideId].js`, `web/lib/checkYourself.js`, `web/pages/dashboard.js`,
`backend/routers/{auth,learning}.py`, migrations for onboarding answers and experiments.

#### Step 1.1: Experiment assignment harness (Size: S)
- Acceptance criteria:
  - `experiment_assignments(user_id, experiment, arm, stratum, assigned_at)` exists. Assignment
    happens at the first `/onboarding` read.
  - 80% of signups get onboarding v2; a 20% holdout keeps the old flow for the whole term. Assignment
    is a deterministic hash of the user id, balanced within sign-in method and Canvas yes/no.
  - The primary metric is recall activation (0.4). With ~37 signups a month the results are
    directional: the report shows both rates with intervals and makes no ship/no-ship call. Report
    09's guardrail is shown alongside: SMS STOP rate (pause a variant above ~5% a week).
- Verification command: `py:test`. Production read: arm counts per day.
- Files likely touched: migration `20261106120000_experiments.sql`, `backend/services/experiments.py`,
  `backend/routers/learning.py`, `web/lib/onboarding.js`.
- Test seams: `tests/test_experiments.py` (deterministic hashing).
- Blocked by: 0.4

#### Step 1.2: Onboarding answers store and step-check fix (Size: S)
- Acceptance criteria:
  - `onboarding_answers(user_id, question_id, question_version, answer jsonb, source, answered_at)`
    holds weak priors.
  - The `onboarding_progress.step` check is widened to match the backend steps (fixes the latent
    `first_guide`/`unlocked` rejection).
  - `PATCH /auth/profile` keeps its fill-only-empty rule.
- Verification command: `py:test`, `rls:test`.
- Files likely touched: migration `20261106130000_onboarding_answers.sql`, `backend/routers/learning.py`,
  `web/lib/onboarding.js`.
- Test seams: RLS test plus route test.
- Blocked by: 0.1

#### Step 1.3: Questions during the build (Size: M)
- Acceptance criteria:
  - The About you step becomes report 10's onboarding set (wording verbatim from report 10), split per
    G2 (decided), inside report 09's 45–60 s build window:
    - while the guide builds: major + year (Q4 list); "Your next big exam — when is it?" (Canvas
      prefilled; "No exam yet — just keeping up"); "It's the night before a quiz. What are you most
      likely doing?" (five options);
    - after the 3-question check, on the reveal: "Pick your study trigger: right after ___ I'll open
      Cordia ___." which creates a `study_blocks` row;
    - moved to day 2: expected/target grade ("Be honest — what grade do you expect on it right now?")
      and morning/evening ("If you could pick, when does your brain work best?").
  - Every question has a "why we ask" line and a skip; no demographics, anxiety or personality items.
    Results are called "starting settings", never a type.
  - Picking a major stores the student's report-02 archetype (one of nine) on their profile
    (`user_profiles.study_archetype`, with `archetype_version`), even though only 4–5 templates ship
    (G3). Majors map to archetypes in `web/lib/majors.mjs`; 4.1 moves the map into the database.
  - Total day one ≤5 minutes to the first recall win (report 09), timed by the QA script.
- Verification command: `web:test`, `build`. The QA Playwright run times the flow.
- Files likely touched: `web/components/AboutYou.js` (rewritten as `OnboardingQuestions.js`),
  `web/lib/majors.mjs` (new), `web/lib/walkthrough.js`, `backend/routers/learning.py`.
- Test seams: `web/tests/onboarding-questions.test.mjs` (pure question logic),
  `tests/qa/onboarding.spec`.
- Blocked by: 1.2

#### Step 1.4: 3-question recall check (Size: S)
- Acceptance criteria:
  - The onboarding check is 3 recall-leaning items, typed or fill where the answer is short (choice
    only as fallback), with Sure / Think so / Guess.
  - It logs `mode='check'` and ends on a first recall win (the easiest item is ordered last).
  - Check yourself elsewhere stays at 5 (Q5), until Phase 3's Quick Check replaces it (report 06).
- Verification command: `web:test`, `build`.
- Files likely touched: `web/pages/quiz/[guideId].js`, `web/lib/checkYourself.js`,
  `web/components/QuizMode.js`.
- Test seams: `web/tests/check-yourself.test.mjs`.
- Blocked by: 1.3

#### Step 1.5: The reveal (Size: M)
- Acceptance criteria:
  - The screen reads "{FirstName}, here's your Cordia" (fallback "Here's your Cordia"), with a
    subtitle naming the major and goal.
  - It shows a dated plan line ("Bio 201 exam in 12 days → 6 short sessions, next one tomorrow 7pm"),
    computed by a deterministic stub of the Phase 3 engine (session count from days and ideas).
  - It shows 2–3 "because" lines, built only from answers given or actions taken. The template text is
    in code, and Claude Haiku phrases them only if templates are not enough.
  - Buttons: **Use this** saves the plan and blocks; **Customize** is a stub until Phase 5.
- Verification command: `web:test`, `build`. A QA screenshot in both themes.
- Files likely touched: `web/components/Reveal.js` (new, replaces `FirstReview.js` in the walkthrough),
  `web/lib/revealPlan.mjs` (new, pure), `web/lib/walkthrough.js`.
- Test seams: `web/tests/reveal-plan.test.mjs`.
- Blocked by: 1.4

#### Step 1.6: Dashboard leads with "Next session" (Size: S)
- Acceptance criteria:
  - The first card is "Next session": the planned block, or Study now if there is no plan. It shows a
    start button and a count.
  - Continue keeps its place below, with reading as a secondary action.
  - The Chrome extension prompt moves to session 2 or 3.
- Verification command: `build`. The dashboard QA screenshot.
- Files likely touched: `web/pages/dashboard.js`, `web/components/NextSession.js` (new),
  `web/components/FirstReview.js`.
- Test seams: QA screenshot only (layout), plus `web/tests/next-session.test.mjs` for the picker logic.
- Blocked by: 1.5

#### Step 1.7: Days 2–7 drip questions (Size: S)
- Acceptance criteria:
  - One question a day, in-app after a completed session (SMS only within quiet hours), report 10's
    order:
    - Day 2: time per weekday (10/20/30/45+ min); expected/target grade and morning/evening if moved
      here by G2; "Is a licensing or entrance exam in your future?" (NCLEX / MCAT / LSAT / Bar / CPA /
      Not yet; ACT removed).
    - Day 3: Mini-IPIP conscientiousness (the Assistant's 4 items). Report 10's exam-nerves item is
      not asked (anxiety is out of v1).
    - Day 4: start timing ("A paper is due in 10 days…") and setback ("You studied hard and got a C…").
    - Day 5: "For hard topics, which helps you start?" (sets `first_view_pref`) and the WOOP obstacle.
    - Day 6: re-show the if-then plan (rehearsal, no new question).
    - Day 7: "was this week's plan too much, about right, or too little?" (load ±25%), plus an
      editable "here's what we learned about how you study" summary and a reset control.
  - Each answer is stored with its question id and version.
- Verification command: `web:test`.
- Files likely touched: `web/components/DripQuestion.js` (new), `web/lib/dripQuestions.mjs`,
  `backend/routers/learning.py`.
- Test seams: `web/tests/drip-questions.test.mjs`.
- Blocked by: 1.2

#### Step 1.8: SMS opt-in during onboarding (Size: S, Assistant repo)
- Acceptance criteria:
  - An optional opt-in uses report 11 example D verbatim, with "[N]/day" replaced by "up to 3 a week"
    and the 8 a.m.–8 p.m. window (the Assistant's 9 p.m. end moves to 8 p.m.), plus "I'm 18 or older".
    Held for owner/lawyer approval of the final text (Q8).
  - It records consent through the Assistant's API and links the existing `assistant_links` flow.
  - The first text quotes the student's if-then words.
- Verification command: Assistant repo tests, plus the Classroom `build`.
- Files likely touched: `web/components/assistant/AssistantSetup.js`; Assistant repo
  `lib/reminders/…`, `app/api/…`.
- Test seams: the Assistant's `can-send` tests.
- Blocked by: 1.5, Q16

### Phase 2: Unified memory (FSRS)
Verified when:
- Learn, Flashcards, Quiz, Study now, MCP `record_answer` and the Assistant read the same `item_memory`;
- `flashcard_progress` still works (expand/contract).

Files to touch: the shared scheduler package `packages/scheduler/` (ts-fsrs), migration `item_memory`,
`web/lib/{learnEngine,spacedReview,retainEngine,studyQueue,studyAnswer}.mjs`, `web/lib/progressSave.js`,
`supabase` RPCs, `web/lib/mcp/writeTools.mjs`, the Assistant's `exam-prep.ts`.

#### Step 2.1: FSRS core behind our own interface (Size: S)
- Acceptance criteria:
  - `review(state, grade, now, desired_retention)` returns the next state and due date.
    `retrievability(state, at)` is pure.
  - It uses ts-fsrs pinned to an exact release at least 2 weeks old at pickup, configured explicitly
    for **FSRS-6 with its default weights** (the 21 FSRS-6 parameters passed in, not left to the
    library default). FSRS-7 is not used.
  - The package also holds today's Leitner, Learn fade and Retain rules (moved, not copied), so the
    web app, the MCP server and the Assistant import one copy.
  - Golden tests match the library's reference outputs.
- Verification command: `web:test` plus the package's own `node --test`.
- Files likely touched: `packages/scheduler/{package.json,index.mjs,fsrs.mjs}`, `web/package.json`
  (workspace dependency), `web/lib/{learnEngine,spacedReview,retainEngine}.mjs` (re-export shims).
- Test seams: golden-vector test.
- Blocked by: the Phase 2 distribution question (Not yet specified)

#### Step 2.2: Grade mapping and ladder rules as pure functions (Size: S)
- Acceptance criteria:
  - The decision log's mapping is implemented exactly:
    - first try of the day only;
    - multiple-choice right → no review;
    - Hard means pass;
    - Easy only for typed + Sure + fast on a mature item.
  - The ladder: Mastered = a recall success since the last lapse AND R ≥ 0.90; falls back to Familiar
    below 0.85. A correct "Guess" is never a recall success (G1), though FSRS rates it Hard (a pass).
  - Exam-ready = first-try recall correct, not guessed, on ≥3 separate study days.
- Verification command: as 2.1.
- Files likely touched: `memory/grades`, `memory/ladder`.
- Test seams: table-driven unit tests, one row per rule.
- Blocked by: 2.1

#### Step 2.3: `item_memory` table (expand) (Size: S)
- Acceptance criteria:
  - Table `item_memory(user_id, item_id, guide_id, stability, difficulty, last_review, due, reps,
    lapses, last_recall_ok_at, exam_ready_days, state, updated_at)`, with PK (user_id, item_id).
  - It is rebuildable from events by a script.
  - RLS: the student reads their own rows. Writes go through one SECURITY DEFINER function (pattern of
    `apply_study_progress`) or the backend (Q9). `mcp_client` writes only through `mcp_record_answer`.
- Verification command: `rls:test`, `lockdown`.
- Files likely touched: migration `20261110120000_item_memory.sql`,
  `supabase/checks/oauth_lockdown.sql`, `tests/rls/item_memory_rls.sql`.
- Test seams: RLS test.
- Blocked by: 0.1, 2.2

#### Step 2.4: Write path: every answer updates `item_memory` (dual write) (Size: M)
- Acceptance criteria:
  - Learn, Flashcards, Quiz, Study now and MCP `record_answer` write `item_memory`.
  - They still write `flashcard_progress` exactly as today.
  - `learning_events` gains `fsrs_rating` and `s/d/r_before`.
- Verification command: `web:test`, `py:test`, `rls:test`.
- Files likely touched: `web/lib/progressSave.js`, `web/lib/studyAnswer.mjs`,
  `web/lib/mcp/writeTools.mjs`, the new RPC or backend route, `backend/services/learning_events.py`.
- Test seams: `web/tests/mcp-write-tools.test.mjs`, `web/tests/study-answer.test.mjs`, and a new
  `memory-write` test.
- Blocked by: 2.3

#### Step 2.5: Seed existing ideas (Size: S)
- Acceptance criteria:
  - A script seeds `item_memory` from the 0.5 snapshot, per Q3 (fresh, or an estimated start state from
    the Leitner box / Learn level).
  - The dry-run output and SQL go to the owner.
- Verification command: `py:test` (script).
- Files likely touched: `backend/scripts/seed_item_memory.py`.
- Test seams: script test.
- Blocked by: 2.4, Q3

#### Step 2.6: Readers switch to `item_memory` (migrate, behind a flag) (Size: M)
- Acceptance criteria:
  - Study now order and Learn's `pickRound`, the fade check, Flashcards due, the MCP `get_due_cards`
    and the knowledge map all read FSRS due dates and R (with ladder from 2.2), behind
    `MEMORY_V2=on` per user.
  - The 5-day fade is gone when the flag is on.
- Verification command: `web:test` (old and new paths), `build`.
- Files likely touched: `web/lib/{studyQueue,learnEngine,spacedReview}.mjs`,
  `web/lib/mcp/readTools.mjs`, `web/components/KnowledgeMap.js`.
- Test seams: existing queue/learn tests run twice (flag off/on).
- Blocked by: 2.5

#### Step 2.7: Exam-date ramp, deadline cap, load smoothing (Size: S)
- Acceptance criteria:
  - Desired retention: 0.85 when more than 21 days out → 0.92 at 7 days → 0.95 at 2 days.
  - Never above 0.95, and never a review due after the test date.
  - No day in the last 5 exceeds 1.5× the student's 14-day average.
- Verification command: as 2.1.
- Files likely touched: `memory/scheduler`.
- Test seams: table tests with synthetic calendars.
- Blocked by: 2.6

#### Step 2.8: Quiz re-correct rule (Size: XS)
- Acceptance criteria:
  - A first-try miss clears after 1 more correct today + 1 correct on each of the next 2 study days.
  - The in-session re-ask stays but no longer clears the miss by itself.
  - `retain_misses` keeps its shape.
- Verification command: `web:test` (`retain-engine`), `py:test` (`retain.py`).
- Files likely touched: `web/lib/retainEngine.mjs`, `web/lib/retainMisses.mjs`,
  `backend/services/retain.py`.
- Test seams: existing retain tests.
- Blocked by: 2.6

#### Step 2.9: Random probe checks (Size: S)
- Acceptance criteria:
  - About 5% of ideas get one recall-format probe 7 days after the last review, logged with
    `mode='probe'`. Probes are excluded from the student's score.
  - The north-star metric is reported in admin metrics.
- Verification command: `py:test`, `web:test`.
- Files likely touched: `web/lib/studyQueue.mjs`, `backend/routers/learning.py` (mode literal),
  `backend/services/metrics.py`.
- Test seams: queue test with a seeded RNG.
- Blocked by: 2.6

#### Step 2.10: Assistant reads `item_memory` (Size: S, Assistant repo)
- Acceptance criteria:
  - `exam-prep.ts` drops its fade/fingerprint copy and reads due/at-risk ideas from `item_memory`.
  - `plan-streak.ts` uses the week-freeze rule.
- Verification command: Assistant repo tests.
- Files likely touched: `cordiaassistant/lib/reminders/{exam-prep,plan-streak}.ts`,
  `lib/db/supabase-repo.ts`.
- Test seams: Assistant reminder tests.
- Blocked by: 2.6, Q16

#### Step 2.11: Contract (Size: S)
- Acceptance criteria:
  - The flag is removed after 2 weeks of matching read-outs: Leitner `schedule` writes stop, while
    `known`/`unknown` stay for the app and MCP readers.
  - The `learn.levels` writer is removed. A migration drops nothing; the old JSON keys stay as
    history.
- Verification command: all suites.
- Files likely touched: as 2.4 and 2.6.
- Test seams: as above.
- Blocked by: 2.7, 2.8, 2.10

### Phase 3: Study plans for any test
Verified when a student picks a test date and gets:
- the Quick Check;
- a four-state map;
- daily tasks;
- a re-plan after a missed day.

All of it is deterministic, with no LLM in the engine.

#### Step 3.1: Plan and diagnostic tables (Size: S)
- Acceptance criteria: `study_plans` (exam, date, horizon, desired-retention schedule, capacity),
  `plan_tasks` (day, kind: review/new/mock/D−1 quiz, minutes, ideas), `plan_changes` (reason, delta)
  and `quick_check_runs` (cluster, item, answer, confidence, P(known) after), per report 01 rules 7–28
  and report 06 §A.
- Verification command: `rls:test`.
- Files likely touched: migration `20261117120000_study_plans.sql`.
- Test seams: RLS test.
- Blocked by: 2.3

#### Step 3.2: Quick Check engine (Size: M)
- Acceptance criteria:
  - 8–12 clusters; a medium "hub" concept per cluster first; ≤3 items per cluster; no concept twice;
    60–70% type-it, 30–40% choice, no written. Static BKT: prior 0.3 (0.5 if the Canvas module grade
    ≥85%); type-it guess 0.05/slip 0.10, choice guess 0.25/slip 0.10; neighbour updates per report 06
    §A; "confidently wrong" never spreads. "I don't know yet" counts as wrong, not confidently wrong.
  - Stops at the first of: 20 items; ≥12 items with every cluster probed and none in 0.35–0.65; "See
    my map now" (after 10); 10 minutes. Skippable ("Just start studying"). Never marks Mastered.
- Verification command: `py:test`/`web:test`.
- Files likely touched: `memory/quickcheck`, `web/pages/plan/[guideId]/check.js` (new).
- Test seams: engine unit tests with seeded answers.
- Blocked by: 3.1

#### Step 3.3: Knowledge map seeding (Size: S)
- Acceptance criteria:
  - Report 06 §C's table seeds map state, Learn level and FSRS (e.g. type-it correct + Sure → Strong,
    Familiar, Good; wrong + Sure → Check these first, Again, re-check in 1 then 3 days). Inferred
    concepts: ≥0.75 "Strong (likely)" seeded Learning; 0.40–0.75 Shaky (likely); else Not checked yet.
  - Results wording is report 06 §D verbatim (three bands; never a percentage or "X/15" headline; lead
    with something right). Its "research shows…" line goes through the report 03 claims checklist.
- Verification command: as above.
- Files likely touched: `memory/seed`, `web/components/KnowledgeMap.js`.
- Test seams: unit tests.
- Blocked by: 3.2

#### Step 3.4: Plan engine (Size: M)
- Acceptance criteria:
  - Report 01: horizon table; gap `clamp(FSRS_interval, 1 day, max(1, f×D_remaining))`; nothing after
    the test; last-5-day load ≤1.5× the 14-day mean; mocks `min(4, max(1, floor(D/7)))` ≥3 days apart,
    last on D−2…D−4; a 10–20 min D−1 quiz; 25/5 blocks; never <7 h sleep.
  - Triage when required sessions × items exceed capacity before D: priority = w_topic × (1 − R_now) ×
    learnability, ordered per rule 26; drop items with R_exam ≥ 0.95; at D ≤ 2 coverage beats mastery.
  - Output is a task list for each day; re-plans after missed days (no streak pressure for 48 h after a
    missed exam-prep day, report 09).
- Verification command: `py:test` (engine lives in the backend: no LLM, the nightly re-plan runs in the
  worker).
- Files likely touched: `backend/services/plans/engine.py`, `backend/routers/plans.py`.
- Test seams: table tests (D = 1, 3, 7, 14, 30).
- Blocked by: 3.3, 2.7

#### Step 3.5: Plan UI and change log (Size: M)
- Acceptance criteria:
  - The screen shows today's tasks, the change log ("Plan updated: you missed 3 enzyme items; +15 min
    tomorrow") and a readiness range (never one number, never a pass probability).
  - The reveal (1.5) switches from the stub to this engine.
- Verification command: `build`, QA screenshots.
- Files likely touched: `web/pages/plan/[id].js` (new), `web/components/{NextSession,Reveal}.js`.
- Test seams: QA plus pure formatter tests.
- Blocked by: 3.4

#### Step 3.6: Calendar blocks and SMS hooks (Size: S, partly Assistant repo)
- Acceptance criteria:
  - Plan tasks become `study_blocks` (existing Google Calendar sync).
  - The Assistant sends plan-day texts within its caps.
- Verification command: `py:test`, Assistant tests.
- Files likely touched: `backend/services/plans/*`, Assistant `plan-day.ts`.
- Test seams: as above.
- Blocked by: 3.5, Q16

### Phase 4: Major archetypes and default layouts
#### Step 4.1: Majors and archetypes data (Size: S)
- Acceptance criteria:
  - `majors`, `study_archetypes` and `major_overrides` exist, seeded from report 02's JSON (archetype,
    default modes, learn formats, tutor mode, dashboard pinned/tucked, suggested connectors, major
    exams). All nine archetypes are stored; each points at one of the 4–5 shipped templates (G3):
    memorization/health; quantitative and programming; reading/writing; business and social science;
    arts, education and undeclared. Majors per Q4.
  - Widget gaps: Study now, Lectures, Class sets, Grades and Plan my week are pages or tabs today, not
    Dashboard cards; each gets a card in 4.2. Report 02's "proposed additions" (NGN builders, code
    sandbox, etc.) are out of this plan. Connectors hidden behind a flag (GitHub, Slack, Dropbox,
    Sheets) are never suggested.
- Verification command: `rls:test`, a seed test.
- Files likely touched: migration `20261124120000_majors_archetypes.sql`,
  `supabase/seed/majors.sql`.
- Test seams: seed test.
- Blocked by: 1.3

#### Step 4.2: `user_layouts` and the resolver (Size: M)
- Acceptance criteria:
  - The table holds cards (size/order), sidebar levels, guide tab order, phone tab, New sheet order,
    Tutor chips, accent token, edited flag, exam-mode flag and version.
  - Resolver rules: the archetype sets pins; an exam within 14 days promotes Exam countdown and Study
    now; Grades is tucked unless the goal is "raise grades".
  - The layout loads with the page data (no flash of a default layout).
- Verification command: `web:test`, `build`.
- Files likely touched: migration `20261124130000_user_layouts.sql`, `web/lib/layout.mjs`,
  `web/pages/dashboard.js`, `web/components/Sidebar.js`.
- Test seams: resolver unit tests.
- Blocked by: 4.1

#### Step 4.3: Three levels and "Show everything" (Size: S)
- Acceptance criteria:
  - Pinned / normal / tucked levels.
  - Settings gains "Show everything".
  - Layout edits are logged to `learning_events`-style `layout_events` for tuning.
- Verification command: `build`.
- Files likely touched: `web/pages/settings.js`, `web/lib/layout.mjs`.
- Test seams: resolver tests.
- Blocked by: 4.2

### Phase 5: Editing and polish
#### Step 5.1: Dashboard edit mode (Size: M)
- Acceptance criteria:
  - Reorder, resize, hide, and a card library labelled "Recommended for {major}".
  - Undo and Reset to recommended; keyboard alternatives for every drag.
  - Offered only after the first completed plan session.
- Verification command: `build`, a keyboard-only QA run.
- Files likely touched: `web/components/DashboardEditor.js`.
- Test seams: QA.
- Blocked by: 4.3

#### Step 5.2: Sidebar, New sheet, guide tab and phone tab customisation (Size: M)
- Acceptance criteria: pinned shortcuts, order, a default guide tab and the phone fifth tab, each with
  undo.
- Verification command: `build`.
- Files likely touched: `web/components/{Sidebar,NewSheet}.js`, `web/pages/guide/[id].js`.
- Test seams: QA.
- Blocked by: 5.1

#### Step 5.3: Exam mode (Size: S)
- Acceptance criteria: offered automatically 7 days before an exam. It promotes plan tasks and hides
  non-study cards, and is reversible.
- Verification command: `build`.
- Files likely touched: `web/lib/layout.mjs`, `web/pages/dashboard.js`.
- Test seams: resolver tests.
- Blocked by: 5.1, 3.5

#### Step 5.4: Streak softening (Size: S, plus Assistant)
- Acceptance criteria:
  - Count study days per week; keep the weekly freeze; add a one-time repair.
  - The server-side streak (`stats.py`) matches `web/lib/streak.mjs`.
  - Never "you lost your streak", in the app or the Assistant.
- Verification command: `py:test`, `web:test`, Assistant tests.
- Files likely touched: `backend/routers/stats.py`, `web/lib/streak.mjs`,
  `web/components/StreakCard*`, Assistant `plan-streak.ts`.
- Test seams: existing streak tests.
- Blocked by: Q16

#### Step 5.5: SMS redesign (Size: M, Assistant repo)
- Acceptance criteria:
  - Texts are course- and date-specific and two-way ("reply 'quiz me'").
  - At most 3 a week by default, backing off after 2 ignored texts.
  - Quiet hours kept; no grades by SMS; no promotion in study texts.
- Verification command: Assistant tests.
- Files likely touched: Assistant `lib/reminders/*`, `lib/inbound/keywords.ts`,
  `lib/messaging/can-send.ts`.
- Test seams: Assistant tests.
- Blocked by: 3.6, Q16

### Phase 6: The outcome loop
#### Step 6.1: Consents (Size: S)
- Acceptance criteria:
  - Four separate consents per report 11: (a) sync course data, (b) sync grades, (c) use grades to
    personalise, (d) use de-identified data to improve defaults. Wording from examples A and B
    (held for approval, Q8). Each stored with its version, revocable in Settings, with "reset my
    profile".
  - Grade features stay off without them.
- Verification command: `rls:test`, `build`.
- Files likely touched: migration `20261201120000_consents.sql`, `web/pages/settings.js`.
- Test seams: RLS plus UI tests.
- Blocked by: none

#### Step 6.2: Test links (Size: S)
- Acceptance criteria:
  - `test_links` connects guides, plans and sessions to a Canvas assignment or a manual test.
  - One-tap "this is an exam" confirmation (replacing reliance on the title regex), plus topic linking.
- Verification command: `py:test`.
- Files likely touched: migration `20261201130000_test_links.sql`, `backend/routers/plans.py`,
  `web/components/AssignmentSheet.js`.
- Test seams: route tests.
- Blocked by: 3.1

#### Step 6.3: Outcomes with class-relative scores (Size: M)
- Acceptance criteria:
  - `study_outcomes` with report 07's per-test fields: assignment, exam format, confirmed-is-exam,
    linked topics; score/submitted/graded/posted, late/missing/excused; mean, median, quartiles,
    min/max, `stats_available`, `stats_reason_missing`; `z_score`, `z_method`; the 21-day window
    snapshot; readiness shown the day before; predicted score; outside study; `grade_source`.
  - The Canvas allowlist gains `include[]=submission&include[]=score_statistics`.
  - z = (score − median) / ((upper_q − lower_q) / 1.349), with the reason recorded when statistics are
    missing (hidden, fewer than 5 graded, not fetched); fallback to within-student course-relative
    scores.
  - Manual and screenshot grade entry (vision via Sonnet; Canvas tokens may expire after 120 days).
- Verification command: `py:test` (allowlist tests in `test_canvas_client.py`).
- Files likely touched: `backend/services/canvas_client.py`, `backend/routers/canvas.py`,
  `backend/services/outcomes.py` (new), migration `20261201140000_study_outcomes.sql`.
- Test seams: canvas client and outcome math tests.
- Blocked by: 6.1, 6.2

#### Step 6.4: Post-test micro-questions and readiness calibration (Size: S)
- Acceptance criteria:
  - Predicted score before; outside-Cordia study after.
  - Readiness the day before vs actual score is logged.
- Verification command: `py:test`, `build`.
- Files likely touched: `web/components/PostTest.js`, `backend/services/outcomes.py`.
- Test seams: unit tests.
- Blocked by: 6.3

#### Step 6.5: Study receipt and tiered insights (Size: M)
- Acceptance criteria:
  - Tier 0/1 come first.
  - Tier 1 after ≥3 posted tests, descriptive only. Tier 2 only when all of report 07's conditions
    hold: ≥4 posted linked tests with ≥3 class-relative; ≥2 above and ≥2 below the student's median;
    posterior ≥0.80 (0.90 if it contradicts the population prior); most study done in Cordia. Insights
    are re-checked after every grade and withdrawn if they drop below the bar.
  - Text comes only from tier-gated templates in code; a test fails on causal wording from
    observational data ("raised your grade", "you're a visual learner"); no aggregate from fewer than
    10 students (report 11 §6).
- Verification command: `py:test` (wording guard), `build`.
- Files likely touched: `backend/services/insights.py`, `web/components/StudyReceipt.js`.
- Test seams: template tests.
- Blocked by: 6.4

#### Step 6.6: Token-expiry reminders (Size: XS, Assistant)
- Acceptance criteria: the Assistant texts 7 days before `canvas_tokens.expires_at`, within its caps.
- Verification command: Assistant tests.
- Files likely touched: Assistant `plan-canvas.ts`.
- Test seams: Assistant tests.
- Blocked by: Q16

### Phase 7: Exam paths
#### Step 7.1: Exam tables (Size: S)
- Acceptance criteria:
  - `exams` (owner, blueprint JSON, `format_version`, effective dates, expiry), `exam_sets` (verified
    flag, reviewer, version) and `exam_outcomes` (opt-in).
  - Content auto-flags when `format_version` expires.
- Verification command: `rls:test`.
- Files likely touched: migration `20261208120000_exam_paths.sql`.
- Test seams: RLS test.
- Blocked by: 3.1

#### Step 7.2: Path engine (Size: M)
- Acceptance criteria:
  - Diagnostic → recall repair → interleaved application → timed simulation, with a readiness gate on
    two consecutive mocks, plus a repeat-taker variant.
  - Reuses 3.2–3.4.
- Verification command: `py:test`.
- Files likely touched: `backend/services/exams/path.py`.
- Test seams: engine tests.
- Blocked by: 7.1, 3.4

#### Step 7.3: NCLEX-RN path, first (Size: S)
- Acceptance criteria:
  - Seed the 2026 test plan (Apr 1, 2026 – Mar 31, 2029) weights from report 05: Management of Care 18,
    Safety and Infection Control 13, Health Promotion 9, Psychosocial 9, Basic Care and Comfort 9,
    Pharmacological and Parenteral 16, Reduction of Risk 12, Physiological Adaptation 14 (midpoints of
    NCSBN's ranges, stored with the ranges). Path phases 5/40/35/20 (diagnostic / recall repair /
    clinical judgment / readiness). Original content only.
  - Named "Cordia Exam Path for the NCLEX-RN® exam", with an "educational practice, not clinical
    advice" line (report 11).
  - Content provenance: pasted "recalled exam" material is rejected.
  - The item bank is not generated in this plan.
- Verification command: `py:test`.
- Files likely touched: `supabase/seed/exams_nclex_rn.sql`, `backend/services/exams/provenance.py`.
- Test seams: provenance tests.
- Blocked by: 7.2

LSAT is the next path after NCLEX-RN. It is planned, not built: no licence is bought until the NCLEX
path has real usage (owner's call, from the 0.4 admin metrics).

#### Step 7.4: Trademark renames and footer (Size: S; can ship any time after approval)
- Acceptance criteria:
  - Every NCLEX surface reads "NCLEX®-style practice".
  - Report 11 example G's footer (NCLEX® line, plus LSAT® when that path ships) appears on every page
    that names an exam: "…None of these organizations is affiliated with, sponsors, or endorses Cordia
    Classroom. Cordia's practice questions are original and are not actual exam questions."
  - Items are labelled "original practice questions, not actual exam questions"; no exam name appears
    in a product name.
- Verification command: `web:test` (a copy test greps the strings), `build`.
- Files likely touched: see the copy audit below.
- Test seams: a copy-guard test.
- Blocked by: none

---

## Copy audit (no changes yet; proposed wording)

Every cap is read from `LIMITS["pro"]` in `backend/services/entitlements.py` (guide 100, tutor 1000,
light 500 AI reading actions, visual 200, lecture_minute 1500). Q6: these ship now, before any A/B.

| File:line | Today | Proposed |
| --- | --- | --- |
| `web/lib/plans.js:29` | "Unlimited study guides from the app and the Chrome extension" | "Up to 100 study guides a month, from the app and the Chrome extension" |
| `web/lib/plans.js:30` | "Unlimited Cordia Tutor" | "Up to 1,000 Cordia Tutor messages a month" |
| `web/lib/plans.js:12` | "Ask Cordia Tutor as much as you need" | "Ask Cordia Tutor up to 1,000 times a month" |
| `web/lib/plans.js:20` | "Read photos, scans and diagrams without limits" | "Up to 500 AI reading actions a month for photos, scans and diagrams" (`light` = 500; visuals are a separate cap of 200, already correct at `plans.js:19`) |
| `web/lib/plans.js:33` | "Guides that adapt to how you learn, every time you study" | "Spaced review that brings back what you're about to forget" (true today; revisit after Phase 2) |
| `web/pages/index.js:16` | "Learns how you study best" | "Brings back what you're about to forget" |
| `web/pages/index.js:14` | "Shows the grade you need on your next assignment" | Keep (it is a calculation from Canvas grades), but add "from your Canvas grades" |
| `web/lib/connectorGuide.js:9` | "…what each assignment needs to keep or raise your grade" | "…what each assignment needs for the grade you're aiming for" |
| `extension/popup.js:45` | "Pro gives you unlimited guides from any page, unlimited Cordia Tutor, and guides that adapt to how you learn." | "Pro gives you up to 100 guides a month from any page, up to 1,000 Tutor messages, and spaced review." (extension release needed) |
| `web/components/assistant/AssistantSettings.js:98` | "Unlimited during your Pro trial" / "Unlimited with Pro" | Keep only if the Assistant is truly uncapped for Pro (it is, per brief §12); otherwise "Up to N a day" |
| `web/pages/guide/[id].js:453` | tab "NCLEX" | "NCLEX®-style" |
| `web/pages/guide/[id].js:536` | "Nursing material detected: NCLEX practice added." | "Nursing material detected: NCLEX®-style practice added." |
| `web/pages/nclex/[guideId].js:30,33,42` | h1 "NCLEX" and errors | "NCLEX®-style practice", plus the footer |
| `web/components/NCLEXQuizMode.js:111,154` | "NCLEX Practice — date", "NCLEX Practice Score" | "NCLEX®-style practice — date", "Practice score" |
| `web/lib/plans.js:16,32` | "NCLEX sets", "NCLEX mode is a Pro feature", "…AI quizzes and NCLEX" | "NCLEX®-style practice sets", "NCLEX®-style practice is a Pro feature", "…AI quizzes and NCLEX®-style practice" |
| `web/lib/pageTitle.js:17` | "NCLEX practice" | "NCLEX®-style practice" |
| `backend/services/entitlements.py:62,75` | "NCLEX sets" | "NCLEX®-style practice sets" (backend deploy) |
| `web/pages/mission.js:11,13` | title "NCLEX Question Generation" | "Exam-style practice for nursing students", body "NCLEX®-style questions written from your own material…" plus footer |
| `web/pages/honor-code.js:59` | lists NCLEX among certification exams | Keep (descriptive), add ® and the footer |
| `CLAUDE.md:62`, brief §1 | "zero hallucination" (internal only) | No user-facing hit. Internal: optional "every answer supported by the source" |

No user-facing "proven", "boost", "pass rate", "official" or "guarantee" claims were found
(`terms.js:65` "We do not guarantee the accuracy" is a disclaimer and stays). The learning-style picker
copy ("Explain things to me with…") changes per the decision log, below.

---

## Migrations (all NOT APPLIED; written as files, applied only by the owner)

| File | Purpose |
| --- | --- |
| `supabase/schema/live-2026-11.sql` | Not a migration: a read-only snapshot of the live schema (baseline) |
| `20261105120000_learning_events_n_options.sql` | `learning_events.n_options`; `mode` adds `probe`, `backfill` |
| `20261105130000_decision_outcomes.sql` | `decision_outcomes` (report 08 fields), RLS service-only |
| `20261106120000_experiments.sql` | `experiment_assignments` |
| `20261106130000_onboarding_answers.sql` | `onboarding_answers` (versioned weak priors); `user_profiles.study_archetype`, `archetype_version`; widen `onboarding_progress.step` check |
| `20261110120000_item_memory.sql` | `item_memory` plus its write function and grants (`mcp_client` via `mcp_record_answer` only) |
| `20261117120000_study_plans.sql` | `study_plans`, `plan_tasks`, `plan_changes`, `quick_check_runs` |
| `20261124120000_majors_archetypes.sql` | `majors`, `study_archetypes`, `major_overrides` + seed |
| `20261124130000_user_layouts.sql` | `user_layouts`, `layout_events` |
| `20261201120000_consents.sql` | `consents` (type, version, granted_at, revoked_at) |
| `20261201130000_test_links.sql` | `test_links` |
| `20261201140000_study_outcomes.sql` | `study_outcomes` |
| `20261208120000_exam_paths.sql` | `exams`, `exam_sets`, `exam_outcomes` |

Every migration adds its tables to `supabase/checks/oauth_lockdown.sql` only if `mcp_client` needs them,
and ships with an RLS test.

---

## Decision log

| Decision | Chosen option | Why |
| --- | --- | --- |
| Order | Instrumentation → Onboarding v2 → FSRS → Plans → Layouts → Editing → Outcome loop → Exam paths (Q1: yes) | Activation is the problem (37/77 never made a guide); measure first |
| FSRS location (Q9) | ts-fsrs in one shared package used by the web app, MCP server and Assistant | Owner: a single copy; answers keep going through the Supabase RPCs |
| FSRS version (Q2) | Exact ts-fsrs pin ≥2 weeks old; FSRS-6 with default weights set explicitly; not FSRS-7 | Owner |
| Existing progress (Q3) | Seed an estimated start state from the Leitner box / Learn level | Owner: yes |
| Majors (Q4) | Curated ~100 with CIP codes, plus Undeclared and Other (free text) | Owner: yes |
| Recall check (Q5) | 3 items in onboarding only; Check yourself elsewhere stays 5 | Owner: yes |
| Copy (Q6) | Ship the audit now; caps come from `entitlements.py` | Owner |
| Next exam path (Q7) | LSAT planned next; no licence until NCLEX has real usage | Owner |
| Legal wording (Q8) | Consent and SMS opt-in text held for owner/lawyer approval | Owner: yes |
| Experiment (Q14) | 80% onboarding v2, 20% term-long holdout; primary metric recall activation; directional only | Owner |
| Assistant scope (Q16) | `cordiaai/cordiaassistant` added for SMS, fade and streak steps | Owner: yes |
| Clean-ups (Q17) | Schema snapshot + header fixes; widen step check; drop VARK from Tutor prompts; `MEMORY_V2` flag | Owner: yes |
| Phase 0 scope | Build on `learning_events`/`decision_events`/`policy_versions`; add `n_options`, `decision_outcomes`, metrics, backfill | Owner instruction; tables are live with rows |
| First try of the day | `NOT learning_events.same_day` (server-computed) | Already correct; no duplicate column |
| Learning styles | No style routing. Keep only "How do you like things explained first?" (which Explain view opens first, stored in `learner_settings.first_view_pref`), always followed by retrieval. Remove copy claiming style matching helps | Resolved conflict |
| Onboarding check vs diagnostic | Onboarding: 3 recall items with confidence. Plan Quick Check: 15 (8–20), skippable, "See my map" after 10 | Resolved conflict |
| FSRS | FSRS-6 default weights behind our interface; FSRS-7 swappable; per-user optimisation later, off the API worker | Resolved; language per Q9 |
| Grade mapping | Typed/fill right + Sure/Think so → Good; typed right + Guess → Hard; written right → Good, partly → Hard; any recall miss → Again; flashcard Got it → Good, Again → Again; MC/match right → no review (Hard at most if ≥1 day since last); MC/match wrong → Again; Easy only typed + Sure + fast on a mature item. First try of the day only. Hard is a pass | Resolved |
| Mastered | ≥1 recall-format success since the last lapse AND R ≥ 0.90; back to Familiar below 0.85; recall requirement never relaxes | Resolved |
| Exam-ready | First-try recall correct on ≥3 separate study days | Resolved |
| Desired retention | 0.85 (>21 d) → 0.92 (7 d) → 0.95 (2 d), never > 0.95, nothing after the test date, last-5-day load ≤ 1.5× 14-day mean | Resolved |
| Quiz re-correct | 1 more correct today + 1 on each of the next 2 study days | Resolved |
| Readiness | Weighted mean predicted recall on exam day, shown as a range, never a pass probability | Resolved |
| Bandit | Postponed; rules plus ≤10–20% logged uniform randomisation among enabled options, propensities stored; future reward = delayed-recall residual | Resolved |
| Grades | Calibrator, not reward; insights tiered and wording-gated in code; no aggregate under 10 students | Resolved |
| Recall formats | Typed, fill, written count as recall; flips, choice and match are recognition | Reports 01, 08; brief §5.1 |
| Correct + Guess (G1) | A pass (FSRS Hard) for scheduling; not a recall win for activation, Mastered or exam-ready | Owner, Nov 5 |
| Onboarding split (G2) | Build: major+year, exam date, night-before habit. Reveal: study trigger. Day 2: expected/target grade, morning/evening | Owner, Nov 5 |
| Templates (G3) | Ship 4–5 templates first; store each student's report-02 archetype on their profile now, so templates can split later without asking again | Owner, Nov 5 |
| Rapid guess | Not computed (no report threshold; MHMDA caution) | Reports 08, 11 |
| Consents | Four, per report 11 | Report 11 |
| SMS window | 8 a.m.–8 p.m. local, ≤3 a week | Report 11 example D, stricter of the two |
| Anxiety questions | Out of v1 (Washington MHMDA) | Resolved |
| Personality | Reuse the Assistant's Mini-IPIP conscientiousness items only | Resolved |
| SMS | Georgia State model: course- and date-specific, two-way, ≤3/week, back off after 2 ignored, quiet hours, no grades, no promotion | Resolved |
| Streaks | Study days per week, weekly freeze, one-time repair, never "you lost your streak"; server and Assistant use the same rule | Resolved + code finding |
| Customisation | Strong archetype defaults first; "make it yours" after the first completed plan session; full edit mode in Phase 5 | Resolved |
| Exam names | Descriptive only: "NCLEX®-style practice", trademark/non-affiliation footer, "original practice questions" label | Resolved |
| Content provenance | Reject recalled-exam material; exam-style items only from course material or public blueprints | Resolved |
| Canvas risk | Every grade feature works with manual or screenshot entry | Resolved |
| Schema baseline | Snapshot live schema before any new migration; correct stale "NOT APPLIED" headers (comments only) | Code finding |
| Expand/contract | `item_memory` dual-written beside `flashcard_progress`; readers switch behind `MEMORY_V2`; writers removed after 2 matching weeks | Prompt + planning rule |

---

## Not yet specified

Second gate: G1–G3 answered Nov 5 (see the decision log). Still open:
- **Later, not a question now:** a Cordia-wide FSRS fit at ~2–5k first-try reviews (report 08) is a
  follow-up plan after Phase 2.

- **Phase 1:** resolved by Q14 (80/20, directional).
- **Phase 2:** how the Assistant (a separate repo) gets the shared scheduler package. Recommendation: a
  private package `@cordiaai/scheduler` published to GitHub Packages from `packages/scheduler/`, with
  the Assistant pinning an exact version. The alternative is a git dependency on a tag, which npm
  can't do for a subfolder without a separate repo. Asked in the second gate; Phase 0 and 1 don't
  depend on it.
- **Phase 6:** whether Canvas returns `score_statistics` for students at USA South (some schools hide
  it). Probe with one real token at 6.3 pickup.
- **Phase 7:** fog: the item-bank generation and review workflow (who verifies, how) is a separate plan.

## Always / Never

- **Always:**
  - preview branches only; migrations as files with RLS tests;
  - production data changes given as SQL;
  - "backend changes are live only after `fly deploy`";
  - colours from `tokens.css`; pages appear whole;
  - domain-neutral generation prompts (majors and exams change UI, defaults and blueprints only);
  - Claude Sonnet/Haiku only for phrasing; core memory and plan algorithms are deterministic code;
  - expand → migrate → contract for data shape changes;
  - every grade feature has a manual path.
- **Never:**
  - push to `main`, promote on Vercel, or run migrations;
  - use Opus;
  - touch the Canvas slideshow capture;
  - expose service-role or Napkin keys;
  - high-school or under-18 features, ACT/SAT, licensed exam content;
  - the contextual bandit, FSRS parameter fitting (global or per user: not in this plan), LTI 1.3,
    cross-student knowledge tracing;
  - the Readiness Certificate, test-anxiety questions, pass-probability numbers;
  - causal claims from observational grade data;
  - a cross-student statistic from fewer than 10 students.

## Progress

| Phase | Status |
| --- | --- |
| 0 Instrumentation | In progress. 0.2 ✅ code (migration `20261105120000` NOT APPLIED; logging works before and after it). 0.4 ✅ `/admin/metrics` (live after `fly deploy`). 0.5 ✅ script (owner runs dry run, then `--apply`). 0.1 and 0.6: read-only SQL in `supabase/checks/phase0_readonly.sql` for the owner (this session lost database access). 0.3 next. |
| 1 Onboarding v2 | Approved, not started |
| 2 Unified memory (FSRS) | Approved, not started |
| 3 Study plans | Approved, not started |
| 4 Archetypes and layouts | Approved, not started |
| 5 Editing and polish | Approved, not started |
| 6 Outcome loop | Approved, not started |
| 7 Exam paths | Approved, not started |
