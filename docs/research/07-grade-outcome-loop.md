# Learning What Works for Each Student: Linking Cordia Study Logs to Canvas Grades

**Bottom line: Cordia can learn which study behaviours seem to help each student, but only by starting from population evidence (retrieval practice and spacing are the strongest predictors), modelling grades relative to the class with a hierarchical Bayesian model that shrinks each student toward similar students, and stating personal insights as hedged associations. With 3–15 graded tests a semester, a single student's data alone will almost never support a confident personal claim within one term.**

## TL;DR

- **What predicts grades:** The most reliable predictors in the research are how much a student practises retrieval (self-testing) and whether that practice is spread across days. Raw time-on-task is a weak and fragile predictor whose apparent effect changes with how "time" is measured. Learning-styles matching has no support.
- **How to model it:** Use a hierarchical (partial-pooling) Bayesian regression. The outcome is a class-relative test score, such as a z-score from Canvas score statistics. Predictors are person-centred study behaviours tied to each test's material. Frequent recall checks (FSRS/Learn data) act as the dense signal, and Canvas grades act as the sparse, noisy anchor that calibrates readiness.
- **What to show:** Show a personal insight only after a minimum-data rule is met: at least 4 linked, posted, class-normalised tests, real variation in the behaviour, and an at least 80% posterior that the direction holds after course adjustment. Word it as "seems to go with better results for you," never "causes." Before the rule is met, show population evidence clearly labelled as such.

## Key Findings (with evidence strength)

| # | Finding | Evidence strength |
|---|---|---|
| 1 | Retrieval practice (quizzing/self-testing) improves real course exam performance | **Strong** (meta-analyses) |
| 2 | Spacing study across sessions/days is associated with better grades in real courses | **Strong** for the experimental spacing effect; **moderate** for observational, self-chosen spacing |
| 3 | Practice-quiz *use* predicts exam grades better than slide/reading access; quiz *timing* (early vs late) did not show a detectable effect in a 2025 study | **Moderate** (single studies) |
| 4 | Time-on-task / clicks is an inconsistent predictor, varies by course, and is sensitive to measurement choices | **Moderate** evidence that it is fragile; **weak** as a predictor |
| 5 | Predictive models do not transfer cleanly across courses; course context changes which behaviours matter | **Moderate–strong** (replicated in learning analytics) |
| 6 | Students, especially low performers, overpredict their exam scores, and low performers stay miscalibrated across a semester | **Strong** (replicated classroom studies) |
| 7 | Matching instruction to "learning styles" improves learning | **Not supported** (repeated null results, including 2025 studies) |
| 8 | Spaced-repetition flashcard use (Anki) is associated with higher licensing-exam scores | **Weak–moderate**: observational, mixed, and one prospective study found no link |

### 1. Retrieval practice is the best-supported behaviour
Yang, Luo, Vadillo, Yu and Shanks (2021, *Psychological Bulletin*) meta-analysed 222 classroom studies with 48,478 students and found that class quizzing improved assessment performance by about half a standard deviation (g ≈ 0.50). Feedback after quizzing increased the benefit. This is foundational pre-2025 evidence, but it is still the main evidence base. Dunlosky et al. (2013, *Psychological Science in the Public Interest*) rated practice testing and distributed practice as the only two "high utility" techniques. They rated rereading and highlighting as low utility. That review is older but still the standard reference.

What this means for Cordia: the behaviours Cordia already logs best (recall attempts, first-try accuracy, Learn ladder progress) are the ones with the strongest link to grades. That is good news for model design.

### 2. Spacing matters, and self-chosen spacing still predicts grades
In a 185-student undergraduate course, Hartwig and Malain (2022, *Learning and Instruction*) found that students "earned higher grades if they spaced their quizzing more – that is, quizzed earlier and more often, even controlling for time," and spaced reading of the textbook was a weaker predictor. In a psychology MOOC, Carvalho, Sana and Yan (2020, *npj Science of Learning*) found that more study sessions per unit "was related to increased performance on end-of-unit quizzes, even when comparing the same student across different time-points in the course," controlling for total time, pretest and retention interval. The benefit was largest for lower-ability students. The Learning Scientists reposted this on their blog on 14 August 2026 ("Call for Sharing Teaching Practice and Repost of Student Ability, Self-Regulated Spaced Practice, and Performance In Online Learning"). Both are observational, so motivation and self-regulation are possible confounds. The authors of the course study say so explicitly.

### 3. What a 2025 LMS study adds
A 2025 *Educational Psychology* study of Moodle resource use ("Motivation and self-regulated learning as predictors of learning resource use in learning management systems in higher education") found that using more practice quizzes predicted better exam grades (β = 0.179, SE = 0.071, p = .012). Accessing lecture slides did not. Doing quizzes earlier in the semester was not detectably better than doing them shortly before the exam. Motivational variables and self-reported self-regulated learning did not directly predict exam grades. This is one study with 44% missing final grades, so treat it as **moderate**. It does suggest that "what you did" (retrieval) matters more than "when you started" on this kind of data.

### 4. Time-on-task is a popular metric that the evidence does not back strongly
A 2025 *Journal of Computers in Education* study of 130 students found that persistence and consistency of engagement were stable, positive predictors of grades. Its review of prior work notes that total online time was a significant predictor in only 12 of 17 courses in an earlier multi-course study. Kovanović et al. (*Journal of Learning Analytics*, 2015/2016) showed that the choice of time-on-task estimation method (idle cut-offs, outlier handling) changed the results of learning-analytics models. Cordia's own idle-tab inflation is exactly this problem. **Popular belief not supported:** "more hours logged = better grade" is not a reliable rule. Use *consistency* (distinct study days) and *retrieval volume*, not raw minutes.

### 5. Course context changes what predicts success
Gašević, Dawson, Rogers and Gasevic (2016, *The Internet and Higher Education*) compared nine courses. They found that generalised models over- or under-estimated the effect of LMS behaviours and that course-specific factors changed which predictors mattered. Older, but still the main citation. For Cordia, every model needs a course (and ideally course-type) term, and a "what works" insight from organic chemistry should not be carried over to a history class without evidence.

### 6. Students are poorly calibrated, so self-report cannot replace grades
Hacker, Bol, Horgan and Rakow (2000, *Journal of Educational Psychology*; foundational) found that high performers predicted their exam scores accurately and improved over the semester, while the lowest performers were grossly overconfident. A 2023 study across four exams in *Journal of Intelligence* ("Low-Performing Students Confidently Overpredict Their Grade Performance throughout the Semester") replicated this, finding that "low-performing students did not become less confident in their erroneous predictions over the course of a semester." Cordia's Sure/Think so/Guess ratings are valuable because they can be scored against actual correctness, which lets Cordia show students their own calibration.

### 7. Learning styles: do not build on them
Pashler et al. (2008) found no adequate evidence for the "meshing" hypothesis. Recent tests still find nothing. A 2025 *Instructional Science* study found no matching effect between learning style and presentation mode. A 2025 quasi-experiment in *Pedagogies* (97 students in the tailored group) found that tailoring English instruction to reported styles did not improve performance. Onboarding should not ask "are you a visual learner?" and personalisation should not be keyed on it.

### 8. Flashcard/Anki evidence is suggestive, not causal
A 2026 systematic review in *Medical Science Educator* (11 studies) found that regular Anki use was associated with higher USMLE Step 1 scores in three studies. The one study that checked Step 2 CK found no benefit, and a prospective cohort (Sun 2021, n = 101) found no link with course exam scores. Deng et al. (2015) estimated about one extra Step 1 point per 1,700 unique cards. That figure is small and comes from 72 students. Useful as context for NCLEX/MCAT paths, but not as proof that "more cards = higher score."

## What Canvas Gives Cordia (and its limits)

| Data | How to get it (student token) | Limits |
|---|---|---|
| Your score, grade, submitted_at, graded_at, posted_at, late/missing/excused, attempt, points_possible | Assignments with `include[]=submission`, or the Submissions API (students may only list their own submissions) | Unposted (hidden) grades don't appear to students. Many institutions default to manual posting, so grades can arrive days after the test |
| Class score statistics: min, max, mean, upper_q, median, lower_q | `GET /api/v1/courses/:id/assignments?include[]=submission&include[]=score_statistics` | Instructure docs: "not included for students if there are less than 5 graded assignments or if disabled by the instructor"; requires `submission` include. Instructors can tick "Hide grade distribution graphs from students," and some universities recommend this for classes of 25 or fewer |
| No standard deviation | — | Score statistics have no SD. Estimate SD from the interquartile range (see appendix) |
| Classic quiz statistics (score_average, score_stdev, etc.) | `/quizzes/:id/statistics` | Gated by a per-user `read_statistics` permission. Student access is not documented and should be assumed unavailable. No official statement was found on student API access to New Quizzes statistics |
| Assignment groups and weights, due dates | Assignments/Assignment Groups APIs | Exam names vary. You need a matching step (user confirms "this is Exam 2") |
| Rate limits | Leaky-bucket throttling. Each response carries `X-Request-Cost` and `X-Rate-Limit-Remaining`. Throttled requests return 403 "Rate Limit Exceeded" (newer docs say 429) | Instructure says a client making one request at a time is unlikely to be throttled. Parallel requests carry a pre-flight penalty. Sync sequentially with backoff |

**The biggest risk is the token model, not the data.** Instructure's Product Blog (Sept/Oct deploys, likely 2025) says tokens created by student-only users "must have an expiration date no more than 120 days away." Instructure's OAuth documentation states that "Applications in use by multiple users MUST use OAuth to obtain tokens," and the legacy docs add that asking users to manually generate a token for your app "is a violation of Canvas' API Policy." Institutions are also locking this down. UW–Madison's knowledge base states that "As of November 14th, 2025, student users in the UW-Madison instance of Canvas can no longer manually generate Access Tokens via the Canvas interface"; students must now request tokens through a form, and those expire within a maximum of 120 days. The University of Missouri says students will not be approved for tokens and reports that Instructure will deprecate token-based API access in the first half of 2027. That date comes from the university's knowledge base and could not be confirmed from an Instructure source. Treat Canvas grades as an optional, possibly temporary data source, and design the feedback loop to work with **manually entered or screenshot-imported grades** as well.

## Recommended Modelling Approach (plain language)

**Step 1 — Put every test on a fair scale.** A 78% in a hard class with a 65% average is a better result than an 85% in an easy class with a 90% average. Convert each test score to a class-relative score:
- **Best:** z-score using the Canvas mean and an SD estimated from the quartiles. Robust alternative: (score − median) / IQR.
- **If class statistics are hidden or there are fewer than 5 graded submissions:** fall back to a *within-student, within-course* score. Compare the test to the student's own average across that course's tests and include a course-level offset in the model, so course difficulty is absorbed by the course term rather than mistaken for a study effect. Flag these tests as "lower-confidence."
- A linear curve (add 10 points to everyone) leaves z-scores unchanged, which is why class-relative scoring handles most curving. Non-linear curving, dropped lowest scores and extra credit cannot be fully corrected. Record them when known.

**Step 2 — Describe how the student studied *for that test*.** Link each study session to the test via the course and the study-guide items mapped to the test's topics. For each test window (for example, the 21 days before the exam), compute a small set of features grounded in evidence: retrieval attempts on test material, distinct study days (spacing), share of study in the final 48 hours (cramming), first-try recall accuracy on test items in the last 7 days, coverage (% of test items reaching Familiar/Mastered), and calibration (how often "Sure" answers were right). Use idle-filtered active minutes only as a secondary feature.

**Step 3 — Separate "this student vs others" from "this student vs their usual."** Centre each behaviour on the student's own average (person-mean centring; Curran & Bauer 2011). The between-student part ("students who space more do better") is heavily confounded by motivation and ability. The within-student part ("this student did better on the tests where they spaced more than usual") removes stable traits such as general motivation and prior GPA, which is what a personal insight needs. It does not remove things that change from test to test, such as illness, workload or topic difficulty.

**Step 4 — Partial pooling: start from similar students, move toward the individual.** Fit a hierarchical Bayesian regression in which each student's effect for each behaviour is drawn from a population distribution, optionally grouped by major or course type. With 3 tests, a student's estimate stays close to the population. With 15 tests and real variation in behaviour, it can move away. This matches the "shrinkage" idea used in recent hierarchical educational models, such as a 2026 hierarchical Bayesian study of the ASSISTments data, where noisy estimates for students with little data are pulled back toward the population mean. Priors come from the published effects (retrieval and spacing positive, raw time near zero) and then from Cordia's own cohort as it grows.

**Step 5 — Use dense recall data as the main signal and grades as the anchor.** Grades are rare and noisy. Recall checks are frequent and directly measure memory. Use a two-layer model:
1. **Memory layer (dense):** FSRS gives each item a predicted recall probability. Cordia checks this against actual recall attempts every day.
2. **Bridge layer (sparse):** predicted test score = f(expected recall on the test's items, coverage, and question-format match). This is fitted to actual class-relative grades, with a per-student offset that is partially pooled.

The bandit keeps optimising on *delayed recall success* (frequent and fast), and grades are used only to check that recall gains translate into test gains and to recalibrate the bridge. Do not make grades the bandit's reward. There are too few, they arrive late, and they are confounded.

**Step 6 — Calibrate "readiness %" against real scores.** Readiness must mean something checkable. After each posted test:
- Log the readiness shown the day before against the actual score.
- Track a reliability plot (predicted vs actual, binned), mean absolute error, and, if you forecast "pass/fail at target," the Brier score.
- Show a range, not a point ("likely 72–85%"), and widen it for students with few tests.
- Recalibrate the readiness→score mapping across the cohort (for example, isotonic or Bayesian logistic calibration) once there are enough pairs.

Calibration against real outcomes should be tracked from day one. Readiness that sits consistently above actual scores would mirror the overconfidence seen in students and erode trust.

**Step 7 — Run small experiments, because observation alone can't settle causation.** The Thompson-sampling bandit is already a randomiser. Where it is safe, randomise *schedule variants* (for example, an extra spaced review vs. none for some items) and compare recall on those items. Within-student randomisation of items is the only way Cordia can earn wording stronger than "seems to."

## Confounds and How to Handle Them

| Confound | Why it matters | Handling |
|---|---|---|
| Motivation / ability | Motivated students both study well and score well | Within-student centring; never claim causation from between-student patterns |
| Course difficulty / instructor | Same behaviour, different grade in a different course | Class-relative scores; course random effect; no cross-course carryover without evidence |
| Curves, drops, extra credit | Change the score scale | z-scores handle linear curves; flag others |
| Reverse causation | Students who feel unprepared cram more | Use behaviour *before* the window closes; treat the cram share cautiously |
| Studying outside Cordia | Cordia sees only part of the study | Ask a one-tap post-test question: "How much did you study outside Cordia?" (none / some / most) and down-weight tests where most study was elsewhere |
| Test-format mismatch | Recall on flashcards ≠ essay exam | Record exam format; include format in the bridge layer |
| Inflated time logs | Idle tabs | Idle-filtered active time only; never a headline insight |

## Data Fields to Log

**Per study session (event-level, from which session summaries are derived):**
- `session_id`, `user_id`, `course_id`, `study_guide_id`, `mode` (Learn / Flashcards / Quiz / Practice / NCLEX)
- `started_at`, `ended_at`, `active_seconds` (idle-filtered), `idle_seconds`, `device`, `entry_point` (texting reminder, dashboard, plan)
- Per item attempt: `item_id`, `topic_ids`, `format` (recall/recognition/problem), `is_first_try`, `correct` (or AI-graded score), `latency_ms`, `confidence` (Sure/Think so/Guess), `hint_used`, `ladder_state_before/after`, FSRS `stability`, `difficulty`, `retrievability_predicted`, `days_since_last_review`
- `scheduled_by` (FSRS / bandit arm id / plan / self-chosen) and `bandit_propensity` (the probability of the chosen arm, needed for any later causal analysis)
- `readiness_pct_at_end` for each linked upcoming test

**Per test (assessment-level):**
- `canvas_assignment_id`, `course_id`, `assignment_group`, `name`, `due_at`, `points_possible`, `exam_format` (MCQ / short answer / problems / essay / mixed), `user_confirmed_is_exam` (bool), `linked_topic_ids`
- `score`, `submitted_at`, `graded_at`, `posted_at`, `late/missing/excused` flags, `attempt`
- Class statistics if available: `mean`, `median`, `lower_q`, `upper_q`, `min`, `max`, `stats_available` (bool), `stats_reason_missing` (hidden / fewer than 5 graded / not fetched)
- Derived: `z_score`, `z_method` (canvas_iqr / within_student / manual), `curve_known` flag
- Snapshot features for the window: retrieval attempts, distinct study days, final-48-hour share, first-try accuracy in the last 7 days, coverage %, calibration score, active minutes
- `readiness_shown_day_before`, `readiness_interval`, student's own `predicted_score` (optional one-tap prompt), post-test `outside_study` answer, `grade_source` (canvas / manual / screenshot)

## Minimum-Data Rule: When Cordia May Show a Personal Insight

These thresholds are design choices informed by the evidence above, not values taken from a published standard. Tune them on Cordia's own data.

1. **Tier 0 — Population tips (always allowed):** "Research on many students shows…" Label it clearly as general evidence.
2. **Tier 1 — Personal pattern (descriptive):** at least **3** posted tests linked to Cordia study. Show the student their own numbers side by side ("Exam 1: 6 study days, 74%. Exam 2: 2 study days, 61%") with **no inference** and a note that more tests are needed.
3. **Tier 2 — Personal insight ("seems to help you"):** all of the following must hold:
   - at least **4** posted, linked tests, with at least **3** that have a class-relative score (Canvas statistics or a valid within-course comparison);
   - the behaviour actually varied (for example, at least 2 tests above and 2 below the student's own median on that behaviour);
   - posterior probability at least **0.80** that the within-student effect points in the stated direction, with the course effect included;
   - the effect agrees in direction with the population prior *or* has posterior probability at least 0.90 if it contradicts it;
   - most study for those tests happened in Cordia (from the post-test question).
4. **Tier 3 — Stronger wording ("helped your recall"):** only for *recall* outcomes from within-student randomised schedules (bandit arms), never for grades.

Re-evaluate after every new grade, and withdraw an insight if it falls below the threshold.

## Example Insight Messages (honest wording)

- **Tier 0:** "Across many studies, students who test themselves do better on exams than students who reread. In one large review, quizzing raised exam scores by about half a standard deviation. That's why Learn asks you to recall, not just recognise."
- **Tier 1:** "Here's how your last three exams in Bio 201 lined up with your studying. It's too early to say what works for you — we need a couple more exams."
- **Tier 2 (positive):** "On your 5 Chem exams so far, the ones you studied for on more separate days tended to go better compared with the class (about 0.4 SD on average). This is a pattern in your data, not proof — other things also changed between exams. Want your next plan to spread study over at least 5 days?"
- **Tier 2 (null):** "We looked at whether studying late at night relates to your grades. So far there's no clear pattern either way, so we're not changing anything."
- **Calibration:** "When you marked answers 'Sure' this week, you were right 71% of the time. Students who check their 'Sure' answers often catch weak spots early."
- **Readiness:** "Readiness: 68% (likely range 60–80%). Last exam, readiness said 75% and you scored 71%, so this has been fairly close for you."
- **Tier 3:** "Cards you reviewed again after 3 days were recalled 12 points more often a week later than cards you didn't. For you, that extra review seems worth it."

Never say: "Spacing raised your grade by 8 points," "You're a visual learner," or "Studying 3 more hours will get you an A."

## Caveats

- All personal insights are observational. Within-student centring removes stable confounds but not changing ones such as workload, illness or topic difficulty.
- Canvas score statistics are frequently unavailable (small classes, hidden by instructors, fewer than 5 graded submissions). Expect many tests to use the fallback method.
- The Canvas token route may close. Student tokens are capped at 120 days, some universities already block them, Instructure's docs call for OAuth for multi-user apps, and a 2027 deprecation is reported by one university but not confirmed by Instructure.
- The thresholds in the minimum-data rule are engineering judgements, not research-validated cut-offs.
- Several supporting studies are single-site observational studies (the 2025 LMS study, the spacing studies, the Anki studies).
- High-school use (minors, FERPA/COPPA) would need separate consent and data-handling review.

## What Cordia Should Do

1. **Make recall the core outcome and grades the calibrator.** Keep the bandit's reward as delayed recall success. Use Canvas grades only to (a) fit the readiness→score bridge and (b) unlock personal grade insights under the minimum-data rule.
2. **Build the class-relative score pipeline now.** Always request `include[]=submission&include[]=score_statistics`. Store the quartiles, compute the IQR-based z-score, and record why statistics are missing. Fall back to within-student course-relative scores.
3. **Add a one-tap "this is an exam" confirmation and topic linking** when Canvas shows a new assignment in an exam-like group. Without reliable test↔material links, nothing downstream works.
4. **Replace time-based headlines with spacing and retrieval metrics.** Finish idle detection, but make "distinct study days" and "retrieval attempts on test topics" the dashboard numbers. Keep minutes as a secondary stat.
5. **Extend the Beta learner profile into a hierarchical model.** Today's Beta distributions (population prior → individual) are already partial pooling for rates. Add a hierarchical regression layer for grade outcomes (student and course random effects, person-centred behaviours), fitted nightly with a lightweight Bayesian tool. Use population priors from the literature until Cordia's own cohort is large enough to estimate them.
6. **Log bandit propensities.** Storing the probability of each chosen arm makes later unbiased (inverse-propensity) evaluation of schedule policies possible, and it is the only route to honest causal wording.
7. **Turn readiness into a calibrated forecast with a range.** Snapshot readiness the day before each test. Publish an internal reliability chart. Recalibrate monthly. Show students "Readiness said X, you scored Y."
8. **Use confidence ratings for calibration feedback, not only scheduling.** Show students their Sure-accuracy, and weight confident errors more heavily in FSRS/Learn, since they mark the misconceptions most likely to cost marks.
9. **Ask two micro-questions per test:** a predicted score before the test (it builds calibration and is cheap) and outside-Cordia study after the test (to down-weight tests Cordia didn't see).
10. **Drop learning-style questions from onboarding.** Use onboarding questions about current strategies (rereading vs self-testing, cramming vs spacing) to set priors and target nudges.
11. **De-risk Canvas.** Apply for an Instructure developer key / OAuth or LTI route via partner institutions. Handle 120-day student token expiry with renewal reminders through the texting assistant. Support manual and screenshot grade entry so the feedback loop survives if tokens are blocked. Sync sequentially and respect `X-Rate-Limit-Remaining`.
12. **Ship the wording rules as code.** Map the insight tier to an allowed template set so no screen or SMS can ever produce causal language from observational grade data.

## Appendix: The Maths

**A. Class-relative score.** For student *i*, test *t* with score *y* (as a percentage):
- SD estimate from quartiles (assumes roughly normal scores): σ̂ = (upper_q − lower_q) / 1.349
- z_it = (y_it − mean_t) / σ̂_t. Robust version: (y_it − median_t) / IQR_t.
- Fallback (no stats): z̃_it = (y_it − ȳ_i,course) / s_pooled, with a course random intercept in the model.

**B. Within/between decomposition.** For behaviour x: x_it = x̄_i + (x_it − x̄_i). Enter both terms. The within-student coefficient is the "for you" effect.

**C. Hierarchical model (one behaviour shown; extend to a vector):**
z_it = α_i + γ_c(t) + β_i·(x_it − x̄_i) + δ·x̄_i + θ·format_t + ε_it,  ε_it ~ Normal(0, σ_t²)
α_i ~ Normal(μ_α, τ_α²); γ_c ~ Normal(0, τ_c²); β_i ~ Normal(μ_β[g(i)], τ_β²)
μ_β ~ Normal(prior from literature/cohort, s²). σ_t is larger for fallback-scored tests.
Shrinkage: in the simple normal case, the posterior mean of β_i ≈ w·β̂_i + (1 − w)·μ_β with w = τ_β² / (τ_β² + SE(β̂_i)²). Few tests → large SE → w near 0 → stays near the population.
Insight rule: P(β_i > 0 | data) ≥ 0.80 (or ≤ 0.20 for negative).

**D. Bridge from recall to score.** Expected recall on test items: R_it = (1/|K_t|) Σ_k p_FSRS(k, t_exam). Model z_it (or percentage) = a + b·logit(R_it) + c·coverage_it + u_i + γ_c + ε, with u_i partially pooled. Readiness % = calibrated predicted score.

**E. Calibration metrics.** MAE = mean|ŷ − y|. Brier (for a target threshold T) = mean(p̂(y ≥ T) − 1[y ≥ T])². Reliability: bin p̂ and compare to observed frequencies. Recalibrate with isotonic regression or Platt/Bayesian logistic scaling across the cohort.

**F. Existing Beta profile as partial pooling.** For a rate (for example, recall success under a strategy): prior Beta(κ·m, κ·(1 − m)) with population mean m and strength κ (the pseudo-count of "similar-student evidence"). After s successes in n trials: Beta(κm + s, κ(1 − m) + n − s). Posterior mean = (κm + s)/(κ + n). It moves from the population to the individual as n grows past κ. Thompson sampling draws from these posteriors. Log the selection probability (propensity) of each arm for later inverse-propensity-weighted policy evaluation.
