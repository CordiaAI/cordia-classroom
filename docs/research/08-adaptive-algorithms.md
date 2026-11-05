# Adaptive Study Algorithms for Cordia Classroom: State of the Art (2025–2026) and a Buildable Plan

**Bottom line:** Cordia's planned design is mostly right, with one correction. FSRS item memory plus an append-only event log is the correct core and should be built now. The contextual bandit and the rich Bayesian learner profile should wait. At ~49 monthly actives, build them first as logged, randomized rules with recorded propensities, and turn on adaptive policies only once the data can support them.

## TL;DR

- **Build FSRS now, and treat recall and recognition as different strengths of evidence.** FSRS is the most accurate open memory model available. On the open srs-benchmark, FSRS-6 reaches a log loss of 0.3460, against 0.4694 for Duolingo's half-life regression (HLR) in the srs-benchmark README and 0.62–0.72 for SM-2 variants. Even FSRS-6 with default parameters beats every SM-2 variant, which solves cold start. Map typed and written answers and flashcard self-ratings to FSRS grades. Let a recognition (multiple-choice) success count only weakly, and let a recognition failure count fully.
- **Skip cross-student knowledge tracing.** BKT, DKT, SAKT, AKT and LLM-based models need items or skills shared across many students. Cordia's per-student, auto-generated items don't have that. The pyKT and simpleKT benchmarks also show the deep-model gains are smaller and less consistent than the papers claim.
- **Use a bandit later, and log propensities from day one.** At Cordia's scale, Thompson sampling gives little or no advantage over uniform random assignment and distorts statistical inference. It nearly doubled false-positive rates (5.0% → 9.4%) and cut power from 0.80 to 0.57 in simulations by Rafferty, Ying & Williams. For now, run guarded rules plus a small randomized slice with logged probabilities, measure delayed recall with random probe items, and drop "learning styles" matching entirely.

## Key Findings (with evidence strength)

| # | Finding | Evidence strength |
|---|---|---|
| 1 | FSRS predicts recall better than SM-2, Leitner-style schedules, HLR and Ebisu on large real-world flashcard data. | **Strong** for prediction accuracy on Anki data (≈10k–20k users, hundreds of millions of reviews). **Unproven** for learning outcomes: the benchmark measures prediction, not how much students learn. |
| 2 | FSRS default parameters are a good cold start, and per-user optimisation beats them after surprisingly few reviews. | **Moderate.** Comes from benchmark and community analyses; not peer-reviewed. |
| 3 | Simple knowledge-tracing models are competitive with deep ones, and published deep-KT gains are inflated by inconsistent evaluation. | **Moderate–strong.** pyKT (NeurIPS 2022) and simpleKT are replicated benchmarks. |
| 4 | Retrieval practice beats restudy; whether recall formats beat recognition formats is contested. | Testing effect: **strong** (multiple meta-analyses). Recall vs recognition: **contested**. |
| 5 | Matching instruction to self-reported learning styles does not improve learning. | **Strong** (multiple reviews; Clinton-Lisell & Litzinger's 2024 meta-analysis found the required crossover in only 11 of 42 outcome measures). |
| 6 | RL and bandit instructional policies help most when constrained by learning-science theory, and often fail when sequencing interdependent content. | **Moderate.** Systematic review of 41 studies (Doroudi et al., 2019, foundational). |
| 7 | Bandit assignment at small N gives little benefit and distorts statistical inference. | **Moderate–strong.** Simulations plus real deployments (Rafferty et al. 2019; Song et al. 2025). |
| 8 | Notification bandits can lift engagement modestly at massive scale. | **Moderate.** One industrial study (Duolingo, KDD 2020); effect sizes are small and need huge N. |
| 9 | High-confidence errors are corrected more often after feedback (hypercorrection) but tend to return after a delay. | **Moderate–strong** (replicated lab findings). |

## Details

### 1. Knowledge tracing: what it is good for, and why it is a poor fit for Cordia's core

**Landscape.**
- **BKT** (Bayesian Knowledge Tracing) is a hidden Markov model per skill with learn, guess and slip parameters. Variants such as KT-IDEM (item difficulty) and Prior-Per-Student are implemented in pyBKT (MIT licence, UC Berkeley CAHLR).
- **PFA/logistic models** predict correctness from counts of prior successes and failures per skill.
- **DKT** uses recurrent networks. Attention models (SAKT, SAINT, AKT, simpleKT) followed, then 2024–2026 work such as DKT2 and LLM-based KT.
- An ITS 2025 survey sorts LLM-based KT into three categories: "LLM-enhanced", "LLM-integrated" and "LLM-standalone". A 2025 literature review reports AUCs around 0.79–0.85 for LLM-based KT models on public datasets such as XES3G5M and EdNet. Those numbers are not comparable across datasets.

**Benchmark caveats (moderate–strong evidence).**
- The pyKT benchmark (NeurIPS 2022) found that published AUCs for the same model on the same dataset vary wildly. DKT on ASSISTments2009 was reported anywhere from 0.721 to 0.821.
- Under standardised evaluation, AKT outperformed almost all other methods. Plain sequential models (DKT, DKT+, DKT-F, KQN) beat the self-attention models SAKT and SAINT in most cases.
- simpleKT, a deliberately minimal model, always ranked in the top 3 by AUC. It recorded 57 wins, 3 ties and 16 losses against 12 deep-KT baselines on 7 datasets.
- Vie & Kashima argue DKT behaves like an implicit dynamic multidimensional IRT model, and that simpler decoders with fewer parameters can predict better.
- Takeaway: complexity buys small, dataset-dependent gains.

**Data requirements.**
- An introductory guide to pyBKT notes that accurate parameter estimation needs on the order of 100 students with at least 15 response sequences per skill.
- Deep models need far more data.
- All KT families assume shared items or shared skill tags, so that one student's data informs predictions for another.

**Implication for Cordia.**
- Cordia's ideas are generated per student per guide. There is no shared item bank and there are no skill tags, so cross-student KT has nothing to pool over.
- A per-item memory model (FSRS) needs no shared items. It models each idea's memory trace from that student's own reviews, and its population-level parameters transfer across items.
- If concept-level transfer is wanted later, the pragmatic route is to cluster ideas into pseudo-skills with pgvector embeddings (within a guide, or across students' guides from the same course or Canvas module) and run a logistic/PFA-style model on those clusters.
- Treat that as a phase-4 experiment, not core infrastructure. Keep LLMs out of the scoring path, as planned.

### 2. Memory models: FSRS and alternatives

**Accuracy comparison (srs-benchmark; strong for prediction).** The open-spaced-repetition benchmark now draws on ~20,000 Anki users and ~1.7 billion reviews; older tables measured FSRS-6's 0.3460 log loss on 349,923,850 reviews from 9,999 collections.

| Model | Log loss (no same-day reviews) | Note |
|---|---|---|
| FSRS-7 (with recency weighting) | 0.3370 | Newest model (34 parameters) |
| FSRS-6 (optimised) | 0.3460 | RMSE(bins) 0.0653, AUC 0.7034 |
| FSRS-6 (default parameters) | ≈0.366 | |
| Duolingo half-life regression | 0.4694 | srs-benchmark README (no same-day reviews) |
| Anki's SM-2 | ≈0.616 | Same table |
| Original SM-2 | ≈0.722 | Same table |

- The benchmark itself notes that SM-2 doesn't output probabilities. Its intervals had to be converted into probabilities, which inflates its log loss.
- The same benchmark lineage reports Ebisu v2 at 0.772 log loss when same-day reviews are included.
- Duolingo's original HLR paper (Settles & Meeder, ACL 2016) reports that HLR roughly halved prediction error relative to Leitner on 13 million learning traces, and improved daily engagement by 12% in a live study. That paper is foundational and still the main published evidence for HLR.

**FSRS-6 vs FSRS-7 (2026 status: in flux).**
- The benchmark describes FSRS-7 as designed for fractional interval lengths and "the only version that can give realistic predictions of probability of recall for same-day reviews".
- With same-day reviews included, FSRS-7 scores 0.3178 log loss versus 0.3842 for FSRS-6. Without them, the two are nearly tied.
- FSRS-7 is propagating through implementations: fsrs-rs aligned its FSRS-7 training defaults in September 2026, and ts-fsrs 6 ships it. However, at least one implementer flags that FSRS-7's untrained defaults can still produce unreasonable intervals and keeps users on FSRS-6.
- Recommendation: start on FSRS-6 via py-fsrs (MIT licence, Python ≥3.10, 21 parameters, actively maintained by the FSRS authors). Wrap it behind your own interface so you can swap in FSRS-7 once a stable Python release exists. Cordia's in-round re-asks make same-day modelling matter more than usual.

**How much data per user.**
- Anki GitHub issue #3094 found optimised FSRS beat the defaults after about 16 reviews, concluding "we can lower this as far as 16, or remove it completely".
- Per the fsrs4anki tutorial, Anki required at least 1,000 reviews in older versions and 400 in Anki 24.04, and Anki 24.06+ has no minimum. Community reports cite about 8 reviews for pre-training and 64 for full optimisation.
- Evidence is moderate and community-sourced.
- Practical rule for Cordia:
  1. Use FSRS defaults.
  2. Then fit one Cordia-wide parameter set once you have a few thousand review events in total.
  3. Then fit per-student parameters only after a student has several hundred qualifying reviews, and only if held-out log loss improves.
- The optimiser (`fsrs[optimizer]`, or the BSD-3 fsrs-optimizer package) pulls in PyTorch. Run it as a nightly batch job outside the single FastAPI worker.

**How FSRS-6 handles same-day repeats.**
- After a same-day review, stability updates by S′ = S·e^{w17·(G−3+w18)}·S^{−w19}.
- Reference implementations floor the multiplier at 1 for passing grades, so a pass never lowers stability.
- In FSRS, "Hard" counts as a success and "Again" as the only lapse. Never use Hard to mean "wrong".

**Desired retention and exam dates.**
- FSRS schedules each review for when predicted recall falls to the target. Intervals scale by ln(R_target)/ln(0.9) relative to the 90% default.
- Anki's documentation calls 90% a balance of workload and retention. It recommends staying below 97%, and its permitted range is 0.70–0.97 (0.99 in newer versions).
- The Anki manual warns: "Above 90% the workload increases very quickly, and above 97% the workload can be overwhelming."
- Ramping the target as an exam approaches is a sound extension of this trade-off. No study has tested it directly in this form, so treat it as a reasoned design, not established evidence.

### 3. One memory record per idea across many formats

This is the hardest design question and the one with the least direct research. The recommendations below combine the testing-effect literature with FSRS mechanics. Evidence is weak to moderate, and the approach should be validated on Cordia's own data.

**What the learning science says about formats.**
- Rowland's 2014 meta-analysis found recall tests produce larger testing effects than recognition. With feedback or high initial success, cued recall reached g ≈ 0.72 and free recall g ≈ 0.81, versus 0.36 for recognition.
- Adesope et al. (2017) found the reverse: multiple choice g = 0.70 versus short answer g = 0.48.
- A 2021 classroom meta-analysis (222 studies, 48,478 students) found no reliable difference between recall and recognition quizzes.
- A university-classroom study by Greving & Richter found short-answer practice beneficial and multiple-choice practice not.
- Verdict: whether recall beats recognition is **contested**. Cordia's rule that only recall formats can master an idea remains defensible as a conservative standard of evidence, even though recognition practice also produces learning.

**Recognition as evidence.**
- Regardless of learning value, recognition is weaker diagnostic evidence of memory.
- A correct answer on a 4-option multiple-choice question is roughly 25% likely by guessing alone.
- A wrong multiple-choice answer, despite cues, is strong evidence of forgetting.

**Recommended mapping (first try of the day only).**

| Event | FSRS grade | Rationale |
|---|---|---|
| Typed/fill-in exact correct, "Sure" | Good | Clean recall |
| Typed correct, "Think so" | Good | |
| Typed correct, "Guess" | Hard | Success, but low retrieval strength |
| Written explanation "right" | Good | AI-graded recall |
| Written "partly right" | Hard | Partial recall still counts as a pass |
| Any recall format wrong / "not quite" | Again | Lapse |
| Flashcard "Got it" | Good | Self-rated; watch calibration |
| Flashcard "Again" | Again | |
| Multiple choice / match correct | No FSRS review, or Hard at most if ≥1 day since last review | Weak evidence: guessable, cued |
| Multiple choice / match wrong | Again | Strong evidence of forgetting |
| "Easy" | Use sparingly, e.g. typed + Sure + fast latency on a mature item | Easy inflates stability a lot |

**Handling rules.**
- Treat in-session repeats (misses returning later in a round; Quiz "right 2 more times about 3 apart") as same-day reviews. Log every attempt, but send only the first attempt per idea per day to the optimiser and to evaluation. That matches how the benchmark evaluates FSRS-6.
- Don't let recognition success build up stability. Otherwise the scheduler learns that multiple-choice-heavy students "remember" more than they do.
- Re-derive the mastery ladder from FSRS state. **Mastered** = at least one recall-format success since the last lapse AND predicted retrievability ≥ 0.90. Fade to **Familiar** when predicted retrievability drops below a threshold (e.g. 0.85), instead of the fixed 5-day rule. The recall requirement for mastery stays fixed.
- Later, learn per-format weights empirically. Fit a small logistic correction on top of FSRS (predicted retrievability + format + confidence → next delayed recall outcome) and check whether it lowers held-out log loss.

### 4. Contextual bandits and adaptive experimentation in education

**Published uses.**
- **ZPDES/RiARiT** (Clément, Roy, Oudeyer, Lopes; JEDM 2015, foundational). Multi-armed bandits sequenced exercises using "learning progress" as the reward. In a study with ~400 schoolchildren, they matched or beat an expert-designed sequence. A 2024 follow-up found that adding learner choice to ZPDES increased intrinsic motivation and strengthened learning.
- **Duolingo notifications** (Yancey & Settles, KDD 2020). The Recovering Difference Softmax algorithm handled novelty effects and per-user recency penalties. Optimising "millions of daily reminders" gave +0.5% daily active users and +2% new-user retention. Conversion was defined as a lesson completed within 2 hours of the notification, and the replication dataset holds 200 million notifications.
- **MOOClet / adaptive experimentation** (Williams and colleagues). Thompson sampling is used to run "adaptive experiments" in courses. A 2024 paper recommends a uniform-random burn-in period before Thompson sampling takes over.

**What the systematic evidence says (moderate).** Doroudi, Aleven & Brunskill's review of 41 controlled studies (IJAIED 2019; foundational) found:
- 21 studies where reinforcement learning (RL) policies significantly beat all baselines.
- 11/14 successes for flashcard-style paired-associate tasks, but 0/8 for sequencing interdependent content.
- 17 of 24 positive results (71%) compared against random or otherwise weak baselines.
- Only 3 of 15 classroom studies found a significant win.
- Their conclusion: RL works best "when it has been constrained with ideas and theories from cognitive psychology and the learning sciences."

**Small-sample statistics (moderate–strong).**
- Rafferty, Ying & Williams (JEDM 2019) simulated two-arm Thompson sampling against uniform random:
  - The false-positive rate rose from 5.0% to 9.4%.
  - Power fell from 0.80 to 0.57 for binary rewards and to 0.49 for normal rewards.
  - The authors conclude that "at least twice as many participants are needed for acceptable statistical power."
  - Effect sizes were overestimated (true d = 0.2 estimated as 0.30).
- Song et al. (arXiv 2025) found that with N = 30, Thompson sampling "shows little or no advantage" over uniform random, and its advantage shrinks as the number of arms grows. Their proposed WAPTS variant helps in some settings but is "not uniformly superior". Those results come from simulation only.

**Delayed rewards, credit assignment, non-stationarity.**
- A reward of "recall success days later" arrives after many other actions. It is also confounded by the scheduler, since items are reviewed when predicted recall is about 90%.
- Better reward: the residual at the next delayed check, y − p̂, where p̂ is FSRS's predicted recall. That removes item difficulty and spacing effects from the signal, so the bandit gets credit only for beating the memory model's expectation.
- Assign credit per idea, attributing the reward to the format or Explain view used at that idea's last exposure.
- Handle non-stationarity by discounting old evidence (exponential decay of Beta counts), and handle novelty as Duolingo did with a recency penalty.

**When a bandit is overkill.**
- For 2–4 options, ~50 active students, and rewards that arrive days later, a bandit's regret savings are tiny and its inference costs are real.
- Prefer randomised rules with logged propensities, analysed by Bayesian hierarchical models.
- Graduate to Thompson sampling with pooled priors when a decision point sees hundreds of independent students per month and the arms' rewards differ plausibly by ≥5–10 percentage points.

### 5. Cold start and learner profiles

**Population priors and pooling.**
- Use FSRS defaults for memory, then a Cordia-wide fit.
- For profile parameters (recall gain per format, Explain-view helpfulness, calibration offset), use partial pooling: student posterior = Beta(α₀ + successes, β₀ + failures), where α₀ and β₀ come from the population mean with a prior strength of about 10–20 pseudo-observations.
- Individual estimates then dominate after about 20–40 relevant observations, which is the standard empirical-Bayes logic. That threshold is a design choice, not a published constant.
- Pool by major or discipline only when each group has enough students to estimate a mean (dozens, not handfuls).

**Learning styles: don't use them (strong evidence).**
- Clinton-Lisell & Litzinger's 2024 meta-analysis found the crossover interaction needed to support matching in only 11 of 42 outcome measures (26.19%). Its pooled effect was small (g = 0.31, 95% CI 0.05–0.57, across 21 studies, 101 effect sizes and 1,712 participants), with uncertain quality and applicability.
- A 2023 review found that 75% of studies yielded no crossover.
- A 2025 quasi-experiment that tailored English instruction to students' learning styles found no performance benefit.
- Will Thalheimer's Substack post "The Learning Styles Challenge After 20 Years" reports a 2025 Hattie & O'Leary synthesis: "Across four meta-analyses specifically testing matching—143 studies and 401 effects—the effect was essentially zero (d = .04)." Treat that figure as secondhand.
- Use "learning style" answers at most as a UI default for which Explain view appears first. The adaptive system should never assume matching helps, and the bandit should be free to learn otherwise.

### 6. Guardrails against "making it easy"

- **The core risk.** Optimising immediate correctness rewards easy formats and short gaps. Delayed residual rewards (above) are the main structural defence.
- **Fixed mastery bar.** Keep the recall requirement and the retrievability threshold as constants outside any learned policy, consistent with Doroudi et al.'s finding that theory-constrained policies work best.
- **Action masking.** The policy only chooses among formats the student enabled. Student choices override it. Exploration is capped (≤10%) and always logged with its probability.
- **Hypercorrection.** High-confidence errors are more likely to be corrected after feedback (Butterfield & Metcalfe 2001; Butler, Fazio & Marsh 2011). The latter study also found high-confidence errors were more likely to reappear on a test a week later. Rules: always give immediate corrective feedback on "Sure" errors, re-test within the session, and schedule an early delayed retest.
- **Calibration incentives.** Never reward "Guess" or "Sure" choices directly. Use confidence only to adjust FSRS grades and to measure calibration (Brier score, calibration curves).
- **Expertise reversal.** Kalyuga's expertise-reversal effect (foundational, not re-researched here) suggests support helpful to novices can hurt advanced learners. Explain views should fade as an idea's stability grows, rather than being optimised for maximal display.
- **Monitoring and fairness.** Track per-policy delayed retention, mastery rate, time-on-task, and distributions by major or course to catch policies that work for one group and harm another.

### 7. Open-source tools (status as of late 2026)

| Library | Use | Licence | Python | Status |
|---|---|---|---|---|
| py-fsrs | FSRS-6 scheduler + optimiser | MIT | ≥3.10 | Actively maintained by the FSRS authors; **use** |
| fsrs-optimizer | Standalone optimiser | BSD-3 | Yes | Maintained |
| fsrs-rs | Rust reference (FSRS-6/7) | Open source | Via bindings | Most active; FSRS-7 work happening here |
| srs-benchmark | Evaluation harness + Anki dataset | Open source | Yes | Very active; reuse its metrics code |
| Duolingo halflife-regression | HLR reference | MIT | Old | Archival; a useful baseline only |
| Ebisu | Bayesian per-card model | Unlicense (public domain) | Yes (v2.2.0 on PyPI) | Elegant, but weaker in the benchmark |
| pyBKT | BKT variants | MIT | Yes | Stable; not a fit for Cordia's item structure |
| pyKT | Deep-KT benchmark | Open source | Yes | Research tool; not for production at this scale |
| MABWiser | Bandits incl. Thompson sampling, LinTS | Apache-2.0 | ≥3.8 | v2.7.4; easy scikit-learn-style API |
| Open Bandit Pipeline | Off-policy evaluation (IPW, SNIPW, DR) | Open source | Yes | Research-grade; use for offline replay |
| Vowpal Wabbit | Production contextual bandits | BSD-3 | Bindings | Powerful, but heavy for one developer |

Note on Thompson sampling: a Beta-Bernoulli Thompson sampler is about 20 lines of NumPy. For Cordia, hand-rolled code with logged propensities is simpler than adding a dependency.

## Recommendations: Stack, Phases, Schemas

### Core schema (Postgres)

**learning_events** (append-only; never update)
- `id`, `user_id`, `idea_id` (guide_id + question fingerprint), `guide_id`, `course_id`
- `session_id`, `round_id`, `mode` (learn / flashcards / quiz / practice / study_now)
- `format` (typed / written / fill / choice / match / flip)
- `n_options` (for guess rate), `attempt_index_in_day`, `is_first_try_today`
- `correct` (bool), `grade_raw` (right / partly / not_quite / again / got_it), `confidence` (sure / think / guess / null)
- `latency_ms`, `explain_view_shown`, `tutor_used`, `hint_used`
- `fsrs_grade_applied`, `p_recall_pred` (FSRS retrievability before the answer), `stability_before`, `difficulty_before`
- `decision_id` (FK, nullable), `client_ts`, `server_ts`, `scheduler_version`, `app_version`

**item_memory** (one row per user × idea; derived and rebuildable from events)
- `user_id`, `idea_id`, `stability`, `difficulty`, `last_review_at`, `due_at`, `state`, `reps`, `lapses`
- `has_recall_success_since_lapse`, `ladder_state`, `params_version`

**policy_decisions** (needed for any future counterfactual evaluation)
- `decision_id`, `user_id`, `decision_point` (format / explain_view / round_size / nudge_time / nudge_template)
- `context` (jsonb), `eligible_actions` (jsonb), `chosen_action`, `propensity` (probability of the chosen action), `all_action_probs` (jsonb)
- `policy_name`, `policy_version`, `was_exploration`, `student_override`, `created_at`

**decision_outcomes**
- `decision_id`, `outcome_type` (delayed_recall / returned_within_48h / sms_converted_2h), `value`, `p_pred`, `residual`, `observed_at`

**learner_params** (posteriors)
- `user_id`, `param_key` (e.g. `format_gain:typed`, `calib_offset`), `alpha`, `beta`, `n_eff`, `updated_at`

**fsrs_params**
- `scope` (global / user), `scope_id`, `weights` (array of 21), `n_reviews`, `heldout_logloss`, `created_at`

**probe_assignments**
- Records which items were randomly selected for unscheduled delayed checks.

### Per-answer vs nightly

**Per answer** (synchronous, milliseconds):
- Write the event.
- Map it to an FSRS grade.
- Update `item_memory` via py-fsrs.
- Pick the next item by rule (lowest retrievability among due items, plus round logic).
- If a randomised decision is made, write `policy_decisions` with its propensity.

**Nightly** (separate Fly machine or scheduled job, not the API worker):
- Run the FSRS optimiser (global; per user when eligible) with time-series cross-validation, adopting new weights only if held-out log loss improves.
- Recompute learner-parameter posteriors with decay.
- Join delayed outcomes to decisions and compute residuals.
- Calculate exam readiness (mean predicted retrievability on the exam date over the guide's ideas).
- Sample probe items.
- Produce metric dashboards.
- Schedule SMS nudges.

### Build order

1. **Phase 0 (now, 1–2 weeks): logging.** Ship `learning_events`, `policy_decisions` and confidence capture. Backfill the existing Leitner history as events. Nothing else is evaluable without this.
2. **Phase 1 (2–4 weeks): FSRS-6 with defaults.** Replace both Leitner and the 5-day fade, unify all modes on `item_memory` using the grade mapping above, and re-derive the ladder. Use exam-aware desired retention: 0.85–0.90 baseline, ramping to about 0.93–0.95 in the final week, capped at 0.97, plus a pre-exam pass ensuring every idea is reviewed in the final days.
3. **Phase 2 (when there are ~2–5k first-try reviews in total): fit and evaluate.** Fit global Cordia FSRS parameters and run the offline benchmark (below). Add the probe-item system.
4. **Phase 3 (in parallel): randomised rules.** For format choice, first Explain view and SMS template/time, use a fixed rule plus ≤10–20% uniform randomisation among eligible options, logging propensities. Analyse with hierarchical Bayesian models monthly.
5. **Phase 4 (hundreds of monthly actives): adaptive policies.** Turn the best-supported decision points into Thompson sampling with pooled priors and residual rewards. Keep a 10% uniform holdout for evaluation, and validate offline with Open Bandit Pipeline before going live.
6. **Phase 5 (optional): embeddings.** Use embedding-based concept clusters for cross-idea transfer, and consider FSRS-7 once a stable Python release exists.

## Pitfalls and How to Avoid Them

- **Scheduler-confounded "retention".** Items are reviewed when predicted recall is ~90%, so observed accuracy at reviews mostly reflects the target, not learning. Fix: random probe checks on a small share of items at fixed delays (e.g. 7 days), independent of the schedule.
- **Recognition inflating memory estimates.** Fix: the asymmetric evidence rule (multiple-choice failures count fully, successes count weakly or not at all).
- **Same-day repeats polluting fits.** Fix: send only first-try-of-the-day reviews to the optimiser and evaluation; log the rest.
- **Using "Hard" as a fail grade.** In FSRS, Hard is a pass. Fix: map partial or uncertain successes to Hard and all failures to Again.
- **Over-fitting per-user parameters.** Fix: adopt per-user weights only when held-out log loss beats the global weights.
- **Bandit learning to be easy.** Fix: residual delayed reward, fixed mastery bar, action masks, exploration cap.
- **Losing propensities.** Without them, offline replay is biased and you cannot evaluate a new policy from old logs. Fix: log the full action-probability vector at every decision.
- **Running the PyTorch optimiser in the API worker.** Fix: a separate batch machine.
- **Personalising on learning styles.** Fix: drop it from adaptation logic.
- **Misreading benchmark wins as learning gains.** srs-benchmark measures prediction accuracy, not review counts or learning. Validate with Cordia outcomes.
- **Novelty effects in nudges.** New SMS templates spike and then decay (Duolingo's "recovering arms"). Fix: recency penalties and multi-week evaluation windows.

## How to Evaluate It

**Memory model (offline, now possible).**
- Replay events in time order with a time-series split per user.
- Compare: Leitner converted to probabilities (baseline), FSRS-6 defaults, FSRS-6 with global Cordia weights, and FSRS-6 per user.
- Metrics: log loss, RMSE(bins) (calibration, using srs-benchmark's formula) and AUC, plus superiority (% of users where model A beats model B).
- Compute separately for recall-format and recognition-format reviews to test the evidence-weighting rule.

**Policies (counterfactual).**
- With logged propensities, estimate a candidate policy's value with IPW, self-normalised IPW and doubly robust estimators in Open Bandit Pipeline.
- IPW is unbiased when the logging policy is known but high-variance when the new policy differs a lot from the old one. Keep candidate policies close to the logging policy, and prefer doubly robust estimates at small N.

**A/B tests and realistic power.**
- Illustrative calculation (our own arithmetic, standard two-proportion formula): detecting a 60% → 70% change in 7-day probe retention at 80% power and α = 0.05 needs about 350 independent students per arm. Cordia cannot run student-level A/B tests on modest effects at ~49 monthly actives.
- Alternatives:
  - Randomise within student at the idea level (e.g. which format an idea gets), which yields many observations per student.
  - Analyse with mixed-effects or hierarchical Bayesian models that account for clustering.
  - Report posterior probabilities and intervals instead of p-values.
  - Accept that only large effects (≥10–15 points) are detectable this year.
- Avoid adaptive allocation for any test you want to infer from, given the doubled false-positive risk.

**Metrics to track.**
- Learning: 7-day probe retention (first try, recall formats); pre-exam final-check accuracy; Canvas exam or assignment grades where available (observational only).
- Model: log loss, RMSE(bins), AUC.
- Metacognition: confidence calibration (Brier score and calibration curve by Sure / Think so / Guess); the high-confidence error rate and its delayed recurrence.
- Engagement: day-1 and day-7 return, study-mode adoption versus reading, sessions per week, SMS conversion within 2 hours (Duolingo's definition).
- Safety: mastery rate by format mix, exploration share, override rate.

## Caveats

- FSRS evidence comes from Anki users (self-selected, mostly self-rated flashcards). How well it transfers to AI-graded written answers and college course material is untested.
- Benchmark numbers are from the project's own README and community posts, not peer-reviewed papers, though the data and code are open.
- The FSRS-7 situation is moving quickly in late 2026.
- The format-to-grade mapping and the exam-ramped retention target are reasoned designs, not validated interventions.
- Several sources here are foundational, not 2025–2026 work: Doroudi 2019, Rafferty 2019, Clément 2015, Settles & Meeder 2016, Butterfield & Metcalfe 2001. They remain the main evidence.
- The Hattie & O'Leary 2025 figure was seen only through a secondary source.

## Popular Beliefs the Evidence Doesn't Support

- **"Deep or transformer KT is clearly better."** Under standardised benchmarks, simple models are competitive and attention models often trail plain recurrent ones.
- **"Bandits always beat A/B tests."** At small N they offer little benefit and distort inference.
- **"Matching to learning styles helps."** It doesn't.
- **"Higher retention targets are always better."** The Anki manual says workload "increases very quickly" above 90%.
- **"Multiple choice is useless for learning."** It is contested. Recognition practice produces testing effects; it is weaker as evidence of memory.
- **"Instant correctness means learning."** Immediate performance is a poor proxy for durable retention, which is why rewards must be delayed.

## What Cordia Should Do

1. **This sprint:** create `learning_events`, `policy_decisions` and `decision_outcomes`. Log `n_options`, confidence, latency, the Explain view shown, `is_first_try_today` and the predicted recall before each answer.
2. **Replace Leitner and the 5-day fade with py-fsrs (FSRS-6, default weights)** in one `item_memory` table shared by Learn, Flashcards, Quiz and Study-now. Use the grade mapping in Section 3: recall and self-rated flashcards count fully; multiple-choice successes count weakly or not at all; multiple-choice failures count as Again; "Guess" successes become Hard.
3. **Re-derive the mastery ladder from FSRS state.** Mastered requires a recall success since the last lapse and predicted retrievability ≥ 0.90. Fade to Familiar below 0.85. Never relax the recall requirement.
4. **Make desired retention exam-aware.** Use 0.85–0.90 normally, ramp to about 0.93–0.95 in the last 7 days before a Canvas exam date, cap at 0.97, and show readiness as mean predicted retrievability on exam day.
5. **Add random probe checks** (e.g. 5% of ideas, 7-day delay, recall format) as the north-star learning metric.
6. **Run the FSRS optimiser nightly on a separate machine.** Fit global Cordia weights once there are a few thousand first-try reviews, and per-user weights only when they beat global on held-out log loss.
7. **Postpone the contextual bandit.** For format, first Explain view, round size and SMS timing, ship transparent rules plus ≤10–20% logged uniform randomisation among options the student enabled. Analyse monthly with hierarchical Bayesian models.
8. **When a decision point reaches hundreds of students per month, switch it to Thompson sampling** with population-pooled Beta priors, residual delayed reward (y − p̂), a recency penalty for nudges, and a permanent 10% uniform holdout. Validate offline with Open Bandit Pipeline first.
9. **Delete learning-style matching from the adaptation logic.** Keep the onboarding question only as a UI default, if at all.
10. **Use confidence for metacognition, not reward.** Trigger immediate feedback, an in-session retest and an early delayed retest for "Sure" errors, and show students their calibration.
11. **Don't build cross-student knowledge tracing.** Revisit concept-level modelling via pgvector clusters only after FSRS is stable and evaluated.
12. **Prioritise day-1 retention.** No algorithm helps students who don't come back. Use the Phase 3 randomisation slots to test onboarding into a first Learn round and nudge timing, measured by day-1 and day-7 return.
