# Building Cordia's Pre-Study Diagnostic: A 15-Question, Confidence-Tagged "Knowledge Map" That Doesn't Scare New Students Away

Cordia should ship a short adaptive check of about 15 questions (10 minimum, 20 maximum) for each course guide. It should be built for coverage and for finding confidently wrong ideas, not for pinpoint measurement. With AI-written items that have no calibration data, no method will deliver CAT-grade precision in 15 questions. What 15 well-spread, confidence-tagged questions can do is put every section of the guide into a rough strong / shaky / confidently wrong / not started map, surface the most dangerous misconceptions, and give the study plan a sensible starting order.

## TL;DR

- **Aim for coverage, not precision.** Even with calibrated items, IRT-based CATs reach usable reliability in about 10–20 items: Tian & Dai's (2020) stress CAT simulation reported marginal reliability of 0.890 at 10 items and 0.937 at 20. But an attribute-level diagnosis across many concepts is much weaker: in a *Psychometrika* real-data DINA analysis, each of 8 attributes was classified with >90% accuracy, but the full pattern was right only 61% of the time (0.6117). Uncalibrated items make the reported precision look better than it is. So Cordia should use 15 questions by default, sampled by section, with simple Bayesian updates and prerequisite inference. Concepts it never touched should be labeled "not checked yet," not guessed at. Evidence: strong on CAT efficiency with calibrated banks; moderate-to-weak on short diagnostics with uncalibrated AI items.
- **Confidence ratings are worth keeping.** They are the cheapest way to find "confidently wrong" ideas. High-confidence errors are *more* likely to be fixed after feedback (the hypercorrection effect, replicated many times). However, they are also more likely to come back a week later if not revisited. So confidently wrong ideas go first in the study plan, get immediate explanatory feedback, and get a scheduled re-check within days. Evidence: strong for hypercorrection; moderate for delayed return. Confidence marking reliably improves score reliability, but has little proven effect on exam outcomes.
- **Frame it as a warm-up, not a test.** Getting answers wrong before studying helps learning: the pretesting effect is g≈0.34–0.54 across meta-analyses for the items that were pretested. Feedback that points at the self rather than the task can backfire; more than a third of feedback effects were negative in Kluger & DeNisi's meta-analysis. Generic growth-mindset messaging adds little (d≈0.02–0.14). Show what the student already knows first, use task-focused language, offer "I don't know yet," and let students stop early.

## Key Findings

### 1. How few questions give a useful map? (CAT, CD-CAT, KST, cold start)

**IRT-based CAT works well in short form, if items are calibrated.** *Strong evidence.*
- Tian & Dai's 2020 *Frontiers in Psychology* stress CAT (93-item bank, 972 students) reported "When the item length was 20, the reliability was 0.937; when the item length was 10, the reliability was 0.890." Its SE(θ)=0.3 stopping rule needed "averagely 10.128 items."
- Function and disability CATs with 10–15 items correlated 0.90–0.99 with full-length scores.
- A 2026 *JMIR Formative Research* knowledge CAT (KEPT-I) correlated >0.90 with the full test after 7 items and 0.95 at 9 items.
- Caveat: these are mostly unidimensional scales measuring *one* trait. Cordia needs to map *many* concepts, which is a much harder problem.

**Diagnosing many skills at once in short tests is much less accurate.** *Moderate evidence; simulation-based.*
- In a *Psychometrika* real-data analysis of a DINA-model test with 8 attributes ("Online Calibration Methods for the DINA Model with Independent Attributes in CD-CAT"), "the correct classification rates of the eight attributes are all greater than 0.9000," but "the entire pattern is only 0.6117." The authors partly blame the item bank: "nearly 50% of the items… have slipping parameters larger than 0.25."
- A 2016 *Acta Psychologica Sinica* study (Tu, Cai & Dai) found that ≥90% pattern accuracy needed roughly 15 or more items. That was for a small number of attributes.
- A 2024 *PLOS ONE* study of nonparametric CD-CAT reached 0.8 classification accuracy only when item quality was high.
- Implication: with 15–25 questions and 30–300 concepts, Cordia cannot classify every concept. At best it can classify *sections or clusters*, plus the specific concepts it asked about directly.

**Knowledge space theory (ALEKS) is the closest commercial model, and it caps at about 30 questions.** *Moderate evidence (vendor/academic).*
- In principle, KST can assess a student in about log₂(number of feasible knowledge states) questions, because answers let it infer concepts it never tested.
- In practice, ALEKS caps the initial assessment at 30 questions. Up to 29 are adaptive, and one is a random "extra problem" used for item testing. This number "strikes a balance between the need to gather enough information… and the risk of overwhelming the student."
- ALEKS's own team (Doble et al., 2021) notes the assessment "most often" ends because it hits the maximum, not because it has converged.
- ALEKS also has an "I don't know" button. Pressing it substantially raises the probability of knowledge states that exclude that item, which shortens the assessment.
- Lesson for Cordia: a mature system with a hand-built prerequisite structure for math still needs about 30 items and usually doesn't converge. Cordia, with no curated prerequisite graph, should expect less.

**With uncalibrated items, CAT precision is overstated.** *Moderate-to-strong evidence that this problem exists; its size varies.*
- van der Linden & Glas (2000) showed that maximum-information item selection "capitalizes" on calibration error. It favors items whose discrimination was overestimated, so standard errors look too good.
- Olea et al. (2012) found that with calibration samples as large as 500–2,000, reported precision was overstated by up to 40%.
- In variable-length CD-CAT, Sun et al. (2020) found calibration error inflated posterior certainty, so tests stopped too early and classification accuracy fell.
- A 2026 *Journal of Intelligence* study found that difficulty predicted from item text (RMSE about 1.08 logits) feeds error into ability estimates without being reflected in the reported precision. Confidence intervals end up covering the true value less often than they claim.
- Nájera et al. (2026), studying small-scale CD-CAT, found that "calibration-free methods also perform satisfactorily but exhibit reliability overestimation with low-quality items."
- **Popular belief not supported:** "Adaptive testing cuts test length in half" assumes a calibrated item bank. Cordia has 77 users and items that are regenerated for each guide, so it cannot calibrate items. Its stopping rules must not trust model-reported standard errors.

**AI-estimated difficulty helps somewhat but is no substitute for calibration.** *Moderate, emerging evidence.*
- A 2026 arXiv study found LLM difficulty estimates had "moderate-to-strong rank-order agreement" with empirical difficulty. The authors call this "an emerging methodological direction rather than… a finished solution."
- A 2024 *Frontiers in Psychology* study ran CAT on *predicted* rather than calibrated difficulties. It needed "only a few more items" to match accuracy, and the gap shrank as prediction quality rose.
- Practical takeaway: use LLM difficulty as a coarse *ordering* (easy / medium / hard within a section). Do not treat it as an IRT parameter.

**Stopping rules seen in practice:**
- *Standard-error threshold:* e.g., SE(θ) ≤ 0.3. This needs calibrated items.
- *Classification confidence:* NCLEX stops when it is 95% confident the candidate is above or below the passing standard.
- *Maximum length:* ALEKS stops at 30; NCLEX at 150.
- *Time:* NCLEX's "run-out-of-time" rule.
- Duolingo's English Test varies its length "according to the grading engine's confidence in your score."
- For Cordia, a **fixed range plus a coverage condition** is the honest rule.

### 2. Covering a large concept inventory with 15–25 questions

- **Stratify by section first.** CD-CAT research on balancing attribute coverage finds that coverage constraints work worst at 10 items, because there are too few items to cover each attribute. That is a reason to set a coverage floor of at least one probe per section and to group small sections into clusters. *Moderate evidence.*
- **Use prerequisite inference cautiously.** KST's efficiency comes from inferring untested concepts from tested ones. ALEKS gets this from expert-built structures. Cordia would have AI-inferred concept relationships, which are untested. Treat an inference as *weak evidence*, and keep it out of "confidently wrong" entirely. *Weak evidence for AI-built graphs; nothing validates them yet.*
- **Spread across difficulty.** The Digital SAT's first module "contains a broad mix of easy, medium, and hard questions" before routing students to the second. This mixed start is a good pattern for a cold start.
- **Unsampled concepts:** no source supports confidently assigning a status to a concept that was never asked. The defensible approach is a prior from the section-level estimate, shrunk toward "unknown," and displayed as "not checked yet."

### 3. Confidence ratings and "confidently wrong" ideas

- **Hypercorrection:** errors made with high confidence are *more* likely to be corrected after feedback than low-confidence errors (Butterfield & Metcalfe, 2001). It has been replicated in children: Metcalfe & Finn (2011) report that "all three experiments showed that Grade 3–6 children hypercorrected high confidence errors." Evidence in older adults is mixed: Cyr & Anderson (2012) found the effect in both younger and older adults, while Eich, Stern & Metcalfe (2013) found "a significantly smaller hypercorrection effect" in older adults. The leading explanation is surprise driving extra attention to the feedback. *Strong evidence.*
- **But they come back.** Butler, Fazio & Marsh (2011): N=50, 120 science questions, confidence rated on a 1–7 scale, feedback given, retest either 6 minutes or 1 week later.
  - Errors corrected: 86% at 6 minutes vs 56% at 1 week.
  - Hypercorrection persisted at 1 week: gamma .28 at 6 minutes vs .19 at 1 week.
  - But the higher the original confidence, the more likely the *same error* was to return at 1 week (gamma = .15).
  - *Moderate evidence; one well-designed study.*
  - Design consequence: correct immediately, then schedule a retrieval check within a few days.
- **Certainty-based marking (CBM)** (Gardner-Medwin, UCL, in use since 1994) "has been clearly shown to improve the statistical reliability and validity of assessment data." Moodle has built it in since version 2.6. *Moderate evidence for reliability gains.*
- However, Smrkolj, Bančov & Smrkolj (2022), studying 89 fifth-year medical students, found "no significant differences between Certainty-Based Score (M = 80.4%…) and Accuracy (M = 79.8%…); t(176) = 0.8327, p = 0.4061." Only 60% of students earned a positive confidence bonus, and mid-achievers were the best self-evaluators; students still rated CBM fair (78%) and useful (94%). *Benefit for outcomes: weak.*
- Burden: a 3-level confidence tap adds one tap per item. No source gathered here measures the drop-off it causes. Cordia already collects confidence, so the extra burden is close to zero.

### 4. Not discouraging low scorers

- **Pretesting helps even when students get answers wrong.**
  - Meta-analyses: g = 0.34 (Boustani & Shanks, 2022, k = 45) and g = 0.54 for pretested information (St. Hilaire et al., 2024, k = 97).
  - The effect is "virtually nonexistent" for *non-pretested* information (g = 0.04).
  - Mera, Dianova & Marin-Garcia (2025, *Journal of Cognition*) found the benefit was larger with immediate feedback (d = 1.22, 95% CI [0.60, 1.84]) than delayed feedback (d = 0.63, 95% CI [0.05, 1.21]).
  - *Strong evidence for the benefit to the specific items tested.*
  - This lets Cordia honestly say "wrong answers here still help you learn," as long as it then *shows the answer and explanation*.
- **Feedback framing:** Kluger & DeNisi's meta-analysis (607 effect sizes) found feedback helps on average (d = .41). But over one third of feedback interventions *decreased* performance, and effectiveness fell as attention moved toward the self and away from the task. *Strong evidence (foundational, 1996).* Results should talk about concepts ("You're shaky on X"), never about the person ("You're weak").
- **Growth mindset is contested.**
  - Macnamara & Burgoyne (2023): overall d ≈ 0.05; d = 0.02 in the highest-quality studies.
  - Burnette et al. (2023): d = 0.14 for targeted, high-fidelity interventions, with prediction intervals from −0.08 to 0.35.
  - *Weak/contested evidence.*
  - **Popular belief not supported:** that a "your brain grows!" banner meaningfully improves performance. Keep messaging factual and task-focused instead.
- **Commercial precedent for low-score framing:**
  - Magoosh: "Getting 4 or 5 correct on a 12-question diagnostic simply means you've identified areas for improvement."
  - Blueprint: "Don't be surprised or discouraged if your diagnostic score is much lower than your goal score."
  - ALEKS tells students to use "I don't know" rather than guess.
- **Gaps:** this research pass did not gather direct sources on stereotype threat replication, test-anxiety effects of placement tests, or measured drop-off from onboarding quizzes in apps. Cordia should treat these as risks to test (see A/B plan below), not as known effect sizes.

### 5. How commercial tools run diagnostics

| Tool | Length | Adaptivity / stopping | Results shown | Feeds study plan? |
|---|---|---|---|---|
| **NCLEX-RN (real)** | 85–150 items, 5 hours, includes 15 unscored pretest items (2026 test plan) | Item-level CAT; stops on 95% confidence rule, max length, or run-out-of-time | Pass/fail | n/a |
| **ALEKS** | Up to 30 (29 adaptive + 1 extra) | KST, Markovian; usually ends at max | "Pie" of topics mastered per slice | Yes – "ready to learn" topics |
| **Khan Academy** | Course challenge 30 Q; unit test ≥9 Q; Mastery Challenge 6 Q (3 skills × 2) | Fixed sampling across skills | Skill levels Attempted/Familiar/Proficient/Mastered (50/80/100 points); shows question count and time beforehand | Moves skill levels up or down |
| **Duolingo placement** | About 10 minutes (third-party estimate) | Adaptive; partial credit added | Starting point in course | Yes – places learner |
| **Duolingo English Test** | Adaptive portion about 45 minutes | CAT; length varies with "grading engine's confidence"; items built with human-in-the-loop generative AI | Score 10–160 | n/a |
| **Digital SAT (Bluebook)** | 98 Q, 2 sections × 2 modules | Two-stage multistage adaptive; module 1 mixes difficulties | 400–1600 | Practice tests feed prep |
| **UWorld NCLEX** | Self-assessments of 100 Q; CATs | Self-assessment is static; CAT adapts | "Probability of passing" Low → Very High; CAT shows "On Track / Needs Improvement" | Study planner |
| **Kaplan NCLEX** | Diagnostic test; 180-Q Readiness Test; 265-Q Question Trainer 7 | 3 CATs in some plans | Strengths/weaknesses; score-to-pass-probability charts (circulated by users) | Structured study phases |
| **Magoosh GRE** | 24 Q / 40 min (or 12 per section) | Not adaptive | Estimated score + number correct | Recommends a study schedule by score |
| **Blueprint LSAT/MCAT** | Full-length real LSAT; half-length MCAT diagnostic | Linear diagnostic; adaptive practice afterward | Analytics on strengths/weaknesses | Study Planner tool |
| **Achievable** | — | "Adaptive engine personalizes each study plan" | Readiness analytics | Yes |
| **Brainscape** | No diagnostic | 1–5 confidence-based repetition | Mastery % | Scheduling |

Notes on evidence quality in the table:
- Vendor pass-rate claims are marketing and not independently verified. Examples: UWorld's "98% pass rate," and its claim that "an average of 70% and a High or Very High result" means a 99% likelihood of passing.
- I did not verify current diagnostic specifics for Quizlet Learn, Princeton Review, Sketchy/Amboss, or ACT official tools.
- The pattern across vendors: big-exam prep uses long diagnostics (100–265 items) and frames results as readiness or probability. Learning platforms use short, low-stakes checks (6–30 items) and frame results as skill levels.

## What Cordia should do

### A. Diagnostic design: single course guide ("Quick Check")

**Length.**
- Default **15 questions**; minimum 8; maximum 20.
- After question 10, show a "See my map now" button. Students who stop early get a coarser map, with more concepts marked "not checked yet."
- Show the count and expected time up front ("15 quick questions · about 6 minutes"), as Khan Academy does.
- Replace the current 5-question "Check yourself" with this. Five questions can't cover more than five sections.

**Selection (no calibration needed).**
1. Cluster concepts by section or topic (use the guide's existing inventory structure). If there are more than 15 sections, merge the smallest so there are about 8–12 clusters.
2. First pass, about one question per cluster: pick a **medium** concept (by LLM difficulty rank) that the LLM tags as having the most dependents (a "hub" concept).
3. Second pass, adaptive:
   - Correct + Sure → probe a *harder* concept in the same cluster once, to confirm strength and allow upward inference.
   - Wrong, or Guess → probe an *easier* or prerequisite concept, to find where understanding drops off.
   - Then spend the remaining questions on the clusters whose posterior is closest to 50/50.
4. Never ask two questions about the same concept. Cap any one cluster at 3 questions.
5. Include an **"I don't know yet"** button, as ALEKS does. It counts as wrong with no confidence, and it is never flagged as confidently wrong.

**Formats.**
- Make about 60–70% of items **Type-it** short answers. They are recall-based, so they give the strongest evidence and, under Cordia's rules, are the only format that can count toward mastery.
- Make about 30–40% **multiple choice**. Use them for conceptual or applied items where typing is awkward, and to keep pace fast.
- Skip *Written* explanations in the diagnostic: they are slow and AI-graded.
- Because recognition caps at Familiar, the diagnostic itself **never marks anything Mastered**. That keeps the existing rule intact and avoids a false sense of being "done."

**Confidence.** Ask Sure / Think so / Guess on every item, using the existing UI.

**Model.**
- Each concept gets P(known). Start with a prior of 0.3 for course guides, or 0.5 if the Canvas grade for that module is ≥85%.
- Update concepts you asked about directly using a Bayesian Knowledge Tracing-style update with fixed guess/slip values (assumed, not calibrated). For example: Type-it guess 0.05 / slip 0.10; MC guess 0.25 / slip 0.10.
- Pass inference along links at reduced weight:
  - Correct + Sure on an advanced concept → prerequisites gain +0.15.
  - Wrong on a prerequisite → dependents lose 0.10.
  - Neighbors in the same cluster move 0.05–0.10 toward the cluster mean.
  - Never pass "confidently wrong" to another concept.
- Treat these numbers as starting heuristics, to be re-fit once Cordia has a few thousand diagnostic-to-Learn outcomes.

**Stopping rule.** Stop at the **first** of these:
- (a) 20 questions;
- (b) ≥12 questions AND every cluster has ≥1 direct probe AND no cluster is in the 0.35–0.65 uncertainty band;
- (c) the student taps "See my map now" (allowed after question 10);
- (d) 10 minutes.

Do not use model-reported standard errors to stop early. With uncalibrated items they are overconfident (Olea et al. 2012; Sun et al. 2020).

### B. Premade big-exam version (NCLEX, MCAT, LSAT, CPA, bar, ACT)

- Use a **two-stage "Baseline"**: a 25-question first stage spread across the official blueprint categories (for NCLEX, the Client Needs categories), then an optional second stage of 15–20 questions targeted at the uncertain categories. Allow saving and resuming between stages.
- Report results by **blueprint category** (strong / shaky / confidently wrong / not checked) plus a coarse readiness band ("early / building / close"). **Do not show a pass probability** until Cordia has outcome data to validate it. UWorld and Kaplan base their predictions on large historical datasets that Cordia lacks.
- For these banks, items are reused across thousands of students, so Cordia *can* calibrate them over time. Log every response and fit a Rasch or 2PL model once each item has a few hundred responses. Only then switch to SE-based or 95%-classification stopping (NCLEX-style).
- Separately, offer a full-length **practice CAT** later in the plan. Do not use it as an onboarding step.

### C. Turning results into the four-state knowledge map

**Directly probed concepts.**

| Answer | Confidence | Map state | Learn level seed | FSRS seed (first review) |
|---|---|---|---|---|
| Type-it correct | Sure | **Strong** | Familiar (existing rule) | Rate "Good"; first review in about 3–4 days |
| MC correct | Sure | **Strong** | Familiar | "Good," but schedule a *recall-format* review first |
| Correct | Think so | **Shaky** | Learning | "Hard"; review in 1–2 days |
| Correct | Guess | **Shaky** (doesn't count, per current rule) | New → Learning | No credit; treat as new |
| Wrong | Sure | **Confidently wrong** | Learning, flagged, first in round 1 | "Again"; re-check in 1 day, then 3 days |
| Wrong | Think so | **Shaky** | Learning | "Again" |
| Wrong / Guess / "I don't know yet" | — | **Not started** | New | No card state; introduce normally |

**Unsampled concepts.**
- P(known) ≥ 0.75 from inference → show as **Strong (likely)** with a "we'll confirm this" marker. Seed at **Learning** (not Familiar). Unverified inferences must not skip recall practice. Schedule one quick confirm item early.
- P(known) 0.40–0.75 → **Shaky (likely)**. Seed at New, with medium priority.
- P(known) < 0.40, or no evidence → **Not started** ("not checked yet"). Seed at New.
- "Confidently wrong" is used **only** for directly observed wrong + Sure answers.

**Seeding the study plan.**
- Order of work: confidently wrong → shaky (probed) → not started, weighted by section size and Canvas exam scope → shaky (likely) → strong (likely) confirm items → strong (probed) spaced reviews only.
- Use the Canvas exam date to set daily load. If time is short, cut strong-concept review first.
- Re-run a 5-question **mini-check** on confidently wrong and inferred-strong concepts 3–5 days in, because high-confidence errors tend to come back after a week (Butler et al., 2011).

**Confidently wrong correction flow.** Correction happens *in the diagnostic results*, not just later.
1. Show the correct answer, then one sentence explaining why their answer was tempting but wrong.
2. Show a short explanation.
3. In Learn round 1, ask again in a *different* format (Type-it).
4. Re-check in 1 day and again in about 3 days.

### D. Results screen wording

**Before the diagnostic (intro card).**
> **Quick Check: 15 questions, about 6 minutes**
> This isn't graded and nobody else sees it. It just helps Cordia skip what you already know and focus on what you don't.
> Not sure? Tap "I don't know yet" — that's useful information too. And guessing wrong here actually helps you remember the right answer later.

**Per-question confidence prompt:** "How sure are you?" Sure / Think so / Guess

**Category labels on the map:**
- **Strong** — "You've got these."
- **Shaky** — "Almost there — a little practice will lock these in."
- **Check these first** (confidently wrong) — "You felt sure, but these didn't match the material."
- **Not checked yet** (not started) — "New to you, or we didn't ask yet. We'll cover them."

**Confidently wrong message:**
> **3 ideas to fix first**
> You answered these confidently, but they don't match your course material. That's actually good news: research shows confident mistakes are some of the easiest to fix once you see the right answer. We'll show you why, then check them again in a couple of days so they stick.

**High score (≈70%+ of probed concepts strong):**
> **Headline:** You already know a lot of this.
> **Sub:** 11 of 15 checks were strong across 7 of 9 sections. Your plan will skip ahead, spend time on 2 ideas to fix and 4 shaky ones, and use quick reviews to keep the rest fresh before your exam on Oct 14.
> **CTA:** Start my plan (about 20 min/day)

**Middle score (≈35–70%):**
> **Headline:** Good start — here's where to focus.
> **Sub:** You're strong on **Cell Transport** and **Membranes**. **Enzymes** and **Glycolysis** are shaky, and 2 ideas need fixing first. That's a clear, doable plan.
> **CTA:** Build my plan

**Low score (<35%, or mostly "I don't know yet"):**
> **Headline:** Your map is ready — and you've got a head start.
> **Sub:** You already got **Cell Transport** right. Most of the rest is new to you, which is exactly what this guide is for. Trying these questions before studying actually helps you learn them faster.
> **CTA:** Start with the basics (15 min today)

Rules for the low-score screen:
- Never show a percentage or "X/15" as the headline.
- Always lead with at least one thing they got right. If there is none, use "You've started — that's the hardest part."
- Keep the first session short.

**Early stop:** "Your map is rough for now. We'll fill it in as you study — no need to take another test."

### E. Guardrails and experiments (given 77 users and heavy drop-off)

1. **Make the diagnostic skippable**, with "Just start studying" equally prominent. If skipped, start everyone as Not started and fold diagnostic-style first-try questions into Learn round 1, so the map fills in passively.
2. **A/B test** 15 vs 8 questions vs skip. Primary metric: day-2 return rate. Secondary metrics: share of students who start Learn, and accuracy on the first retrieval round. With only about 77 users, results will be underpowered at first. Treat early results as directional and keep the test running as sign-ups grow.
3. **Log everything** (item, concept, format, confidence, latency, later Learn outcomes). This lets Cordia replace the heuristic guess/slip and inference weights with fitted values, and eventually lets the contextual bandit choose the next probe.
4. **Don't add** learning-styles questions or "your brain grows" banners. Nothing in the evidence reviewed here supports them, and they add friction.

## Caveats

- Most CAT and CD-CAT accuracy figures come from **simulations with calibrated item banks**. Nothing published directly tests short diagnostics built from LLM-generated, single-use items across arbitrary domains. Cordia's numbers (priors, guess/slip, inference weights, thresholds) are design assumptions to be validated, not evidence-based constants.
- The hypercorrection literature mostly uses general-knowledge trivia with immediate feedback. Its transfer to applied domains like nursing judgment or legal reasoning is plausible but less tested.
- Commercial-tool details come from vendor pages, help centers, and some third-party reviews. Readiness and pass-rate claims are marketing.
- Gaps in this research: no direct evidence was gathered on stereotype threat, test anxiety from placement tests, or onboarding-quiz drop-off in apps. Hattie & Timperley's feedback model is consistent with the task-focused recommendations above but was not re-reviewed here.
