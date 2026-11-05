# How Students Should Study for a Test: Evidence-Based Rules for Cordia Classroom's Study-Plan Algorithm

The best-supported plan is spaced, feedback-backed retrieval practice: make students recall answers across several separate days, widen the gaps in proportion to the time left before the test, stop adding new material in the last day or two, and protect sleep. Cramming, rereading and all-nighters do worst. Cordia's current design (recall-only mastery, misses that come back, test-date quotas) already matches most of this evidence. The biggest gaps are that it doesn't spread re-correct attempts across sessions, it has no deadline-aware scheduler, and it has no rules for mock exams or sleep.

## TL;DR

- **Retrieval practice and spacing are the two techniques with strong, replicated evidence.** Testing beats restudy by about g = 0.50 in lab and classroom meta-analyses, roughly 0.73 with feedback against 0.39 without. Spaced retrieval beats massed retrieval by g = 0.74. Expanding and uniform gaps perform the same. Self-explanation (g = 0.55) and interleaving (g = 0.42) help in the right conditions but have narrower boundaries.
- **Gap length should scale with time to the test, and the ratio shrinks as the horizon grows.** Cepeda et al. (2008) found the best gap was about 20–40% of a 1-week retention interval and about 5–10% of a 1-year interval. In practice: about 1 day for a 3-day horizon, 2–4 days for 2 weeks, 4–8 days for a month, and 1–2 weeks for 3 months. Each item should be correctly recalled at least once in each of 3+ separate sessions.
- **FSRS-6 is the most accurate open scheduler, but it has no built-in exam date.** On the open srs-benchmark (about 10k Anki collections) it has the lowest log loss: 0.346, against 0.47 for HLR and 0.62 for Anki's SM-2. Cordia must add the deadline logic itself: cap intervals at the exam, aim predicted recall *on exam day* at 0.90–0.95, and use 0.85–0.90 desired retention far out. Workload rises steeply above 90%.

## Key Findings

### 1. Technique summaries and evidence ratings

| Technique | Plain-language summary | Best estimate | Evidence |
|---|---|---|---|
| Retrieval practice (testing) | Pull the answer out of memory instead of rereading it | g ≈ 0.50 vs restudy (Rowland 2014); g = 0.61 (Adesope 2017); g = 0.499 in 222 classroom studies, 48,478 students (Yang 2021) | **Strong** |
| Spacing / distributed practice | Spread the same study time over several days | Spaced vs massed retrieval g = 0.74; expanding vs uniform g = 0.03, not significant (Latimier et al. 2021) | **Strong** |
| Successive relearning | Retrieve each item until correct, then come back in later sessions and do it again | Better than a letter grade over usual studying in a real course (Rawson et al. 2013) | **Strong** (one lab group, many replications) |
| Self-explanation / elaborative interrogation | Explain *why* or *how* while studying or solving | g = 0.55 overall; 0.41 when time is equated (Bisra 2018) | **Moderate** |
| Interleaving | Mix similar problem types or categories within a session | g = 0.42 overall; 0.67 for paintings; negative for word lists (Brunmair & Richter 2019) | **Moderate**, depends on material |
| Rereading, highlighting, summarizing | Passive review | Rated "low utility" (Dunlosky et al. 2013) | **Strong evidence of weak effect** |
| Learning-style matching | Teach to "visual/auditory" types | Pashler 2008 found "virtually no evidence"; Clinton-Lisell & Litzinger's 2024 meta-analysis (21 studies, 1,712 participants) found g = 0.32, with only 26% of outcome measures showing the needed crossover, and judged the benefits "too small and too infrequent to warrant widespread adoption" | **Not supported** |

**Retrieval practice: when it works and when it doesn't.**
- *Feedback.* Rowland's (2014) meta-analysis found feedback almost doubled the effect, g = 0.73 against 0.39. Yang et al. (2021) found corrective feedback, repeated testing and longer interventions all increased classroom gains.
- *Initial success.* With no feedback and initial recall at or below 50%, Rowland found essentially no testing effect (g = 0.03). Above 75% initial success the effect was g = 0.56. So a failed retrieval without feedback is nearly wasted. A failed retrieval followed by the answer is not.
- *Delay.* Roediger & Karpicke (2006) showed a crossover. Five minutes after learning, repeated study beat repeated testing (83% vs 71%). One week later, testing won (61% vs 40%). Restudy only looks better on very short delays.
- *Format.* Typed or spoken retrieval beats retrieving "in your head". In Rivers, Northern & Tauber (2025, Educational Psychology Review), overt retrieval beat restudy by g = 0.63–0.91, against 0.16–0.54 for covert retrieval. A 2025 meta-analysis by Yu et al. (18 studies, 2,560 participants) confirmed that "overt retrieval is more effective than covert retrieval (g = 0.17)". This supports Cordia's rule that only typed or explained answers can reach Mastered. Matching the practice format to the exam format gives a modest extra boost (Adesope 2017). All quiz formats help in classrooms (Yang 2021).
- *Material and level.* The effect holds across ages, subjects and health-professions training (2025 state-of-the-art review). One caveat: Murray, Horner & Göbel's 2025 meta-analysis on **mathematics** found spacing still helped (g = 0.28 across 27 studies and 53 effect sizes), but the testing-vs-restudy effect was small and not reliable (g = 0.18 across only 7 studies and 32 effect sizes, with a 95% confidence interval that "crossed zero"). For problem-solving subjects, "retrieval" should mean solving fresh problems, not reciting solutions.

**Spacing: when it works.** The spacing effect is among the most robust findings in learning research. Cepeda et al.'s (2006) synthesis of 271 comparisons found final recall averaged 47.3% after spaced study against 36.7% after massed study, with study time held equal. That synthesis is foundational and older, but it is still the main evidence. The math meta-analysis found smaller effects inside real courses (g = 0.24) than in isolated lab tasks (g = 0.43), so expect real-world gains to be modest but real.

**Self-explanation.** Bisra et al.'s (2018) meta-analysis covered 64 reports, 69 effects and 5,917 participants. It found g = 0.55 overall, 0.41 when time on task was equal, and 0.61 for university students against 0.43 for high schoolers. Self-explanation also beat reading a provided explanation (g = 0.35). It works best on worked examples, procedures, cases and "why" questions. That makes it a good fit for nursing rationales, business-law reasoning and CS code tracing. It is less useful for arbitrary facts such as dates or drug names.

**Interleaving.** Interleaving helps most when categories are *similar to each other* and easy to confuse, for example artists' styles, disease presentations, legal doctrines, or which algorithm or formula to use. The meta-analysis advises caution "especially for expository texts and words." Rule: interleave *practice problems and discrimination tasks*, not first-time reading of new text.

### 2. Optimal spacing for a fixed test date

Cepeda et al. (2008) is still the key study: more than 1,350 learners, gaps up to 3.5 months, tests up to 1 year later. Their findings:
- For every test delay, performance first rose and then slowly fell as the gap grew.
- The optimal gap *increases* with the retention interval (RI), but the *ratio* of gap to RI *decreases*. It was about 20–40% of a 1-week RI and about 5–10% of a 1-year RI. For a 350-day RI the best gap was 23 days.
- The curve is asymmetric. A gap that is too long costs much less than one that is too short. When unsure, err longer.

Latimier et al.'s (2021) meta-analysis found **no difference between expanding and uniform schedules** (g = 0.034). Cordia doesn't need to force expanding gaps. What matters is that the reviews are spaced and the final gap fits the time left. (Points for horizons other than 1 week and 1 year are my interpolation from Cepeda's curve, not direct measurements.)

| Days to test | Suggested gap between sessions on the same item | Basis |
|---|---|---|
| ≤ 3 days | ~1 day (sleep between sessions) | Extrapolated from Cepeda 20–40% at 1 week |
| ~1 week | 1–3 days | Cepeda 2008, measured |
| ~2 weeks | 2–4 days | Interpolated |
| ~1 month | 4–8 days | Interpolated (~15–25%) |
| ~3 months | 1–2 weeks | Interpolated (~10–15%) |
| ~1 year | 3–5 weeks | Cepeda 2008, measured |

Successive relearning tells you *how many* sessions. Rawson & Dunlosky recommend practising to 3 correct recalls initially, then relearning about 3 times at spaced intervals. Three correct recalls spread over three sessions beat three in one session by more than double. In one dataset, recall one week later was about 69% against about 20%.

### 3. Cramming versus distributed study

Cramming really does work for an *immediate* test. Restudy wins at 5 minutes (Roediger & Karpicke 2006), and massed practice can match spacing on a next-day test. It fails for anything later. The gap reverses within days, and in Rawson et al.'s (2013) course study, students who didn't space their practice forgot rapidly after the exam. College exams are cumulative (midterm, then final, then the next course, then NCLEX), so cramming is a losing strategy even for students who only care about grades. **Evidence: strong.**

### 4. Practice tests and mock exams

- **Low-stakes practice tests reduce test anxiety rather than causing it.** Yang et al.'s (2023) meta-analysis (24 studies, 3,374 participants) found practice tests reduce test anxiety. *Easier* practice tests reduced it more than difficult ones. The testing effect itself is barely affected by students' anxiety levels (Yang 2021). **Evidence: moderate.**
- **A review quiz the day before the exam helps.** In a classroom study, McDaniel et al. (2011) found quizzing raised unit-exam scores by 13–25%, and a review quiz given 24 hours before the unit exam gave the largest gains. **Evidence: moderate** (one well-controlled classroom series).
- **Number and timing of full-length timed mock exams: weak evidence.** I found no controlled study comparing how many full-length mocks to take or exactly when. Recommendations here come from transfer-appropriate processing (practise in the exam's format and conditions), the anxiety findings, and spacing logic. Treat them as engineering defaults to test in Cordia's own A/B experiments.

### 5. Sleep, session length, breaks and fatigue

- **Sleep before learning matters most.** Newbury et al.'s (2021) meta-analyses covered 1970–2020. A night of total sleep deprivation *before* learning impaired memory with g = 0.62. Deprivation *after* learning had a smaller but real effect, reported as g ≈ 0.28. **Evidence: strong.**
- **Partial sleep loss is nearly as harmful.** Crowley, Alderman, Javadi & Tamminen's 2024 meta-analysis (125 effect sizes, 39 reports, 1,234 participants) found that restricting sleep to 3–6.5 hours, compared with 7–11 hours, impaired memory formation (g = 0.29, 95% CI 0.13–0.44). The authors concluded that "missing some sleep has similar consequences for memory as not sleeping at all." Catch-up sleep may not undo the cost. **Evidence: moderate–strong.**
- **Sleep over weeks predicts grades better than the night before.** In Okano et al.'s (2019, npj Science of Learning) Fitbit study of an MIT chemistry course, sleep duration, quality and consistency together "accounted for 24.44% of the variance" in grades (quality 9.68%, inconsistency 7.6%). Sleep on the single night before a test was *not* related to scores, but sleep over the prior week and month was. This is correlational (one course, about 88 students). The practical lesson: an all-nighter ruins the encoding of whatever you study that night, and good sleep only in the last night can't make up for weeks of poor sleep.
- **Breaks: fixed schedules help moderately, but findings are mixed.** In Biwer et al. (2023), 87 students took systematic breaks (24 min study / 6 min break, or 12/3) or self-chosen ones. Self-chosen breaks led to longer sessions with more fatigue and distraction. Fixed breaks got similar work done in less time. Later studies (2024–2026) found no performance difference, and one found self-chosen breaks came with better mood. **Evidence: weak–moderate.** Fixed breaks are a safe default, not a proven performance boost. I found no good evidence for an optimal *total* daily study time.

### 6. Spaced-repetition algorithms in 2025–2026

The open-spaced-repetition srs-benchmark uses about 10,000 Anki collections and about 350 million reviews. It measures how well each algorithm *predicts* recall, using log loss and RMSE(bins), where lower is better.

| Algorithm | Log loss ↓ | RMSE (bins) ↓ | AUC ↑ | Notes |
|---|---|---|---|---|
| FSRS-6 (trained per user) | 0.346 | 0.065 | 0.703 | 21 parameters; current best non-neural |
| FSRS-6, default parameters | ~0.366 | ~0.093 | ~0.696 | Relevant for new users with no history |
| FSRS v4 | 0.373 | 0.084 | 0.685 | 17 parameters |
| HLR (Duolingo) | 0.469 | 0.128 | 0.637 | 3 parameters |
| Anki SM-2 | ~0.616 | ~0.172 | ~0.613 | August 2025 table, last to include SM-2 |
| SM-2 (original) | ~0.722 | ~0.203 | ~0.603 | |
| Leitner | — | — | — | Not a recall model; can't produce calibrated predictions |
| SM-17/18 | — | — | — | Proprietary; no verified public benchmark numbers found |

FSRS-6 with recency weighting beats Anki's SM-2 for about 99.5% of collections. An independent 2026 reproduction matched FSRS-6 within the benchmark's confidence interval. Even with *untrained default* parameters, FSRS-6 beats every SM-2 variant. That matters for Cordia, whose users start with no review history. **Caveats:**
- The benchmark measures prediction accuracy, not learning gains.
- It is built on Anki flashcard reviews, mostly language learning and medicine, not typed AI-graded answers.
- Some SM-2 log loss comes from converting intervals into probabilities.

**Desired retention and workload.** The Anki manual warns that above 90% desired retention "the workload increases very quickly, and above 97% the workload can be overwhelming." Example (Taalhammer worked example, default FSRS-6 curve, a card with 10-day stability): the next review comes after about 33 days at 80%, 10 days at 90%, 4 days at 95%, and about 2 days at 97%. Going from 90% to 95% more than doubles reviews for that card. Anki's old "minimum recommended retention" calculator mostly returned about 70% under FSRS-6 and has been replaced by a workload simulator (25.07). That ~70% figure minimises long-run time per item remembered. It is the wrong target for someone with an exam in 10 days.

**Deadlines.** FSRS has **no native exam-date mode**. It's an open feature request (fsrs4anki-helper issue #456). Community proposals include:
- capping each item's maximum interval at the days left to the exam
- scheduling as if desired retention were higher whenever an interval would pass the deadline
- read-only "daily target" add-ons such as Deckline

One forum simulation warned that naive deadline logic can produce about 3× normal reviews just before the exam. Cordia must smooth the workload instead of letting it pile up.

### 7. Triage when time is short

- **Region of proximal learning (Metcalfe & Kornell).** Under time pressure, the most efficient choice is to drop what's already known, then study the *easiest not-yet-learned* items first, then medium-difficulty ones. In their experiments, giving most time to medium-difficulty items produced the best performance. Pouring scarce time into the hardest items gives little return. **Evidence: moderate** (lab word-pair studies).
- **Exam weight comes first.** Exam weight beats difficulty, because a point is a point. There is no direct experimental evidence on this; it follows from expected-value logic.
- **Breadth before depth when coverage is incomplete.** One successful retrieval with feedback on each high-weight idea beats mastering a few ideas while leaving others untouched. This is an inference from the testing literature: the first retrieval gives the largest gain, and later ones give diminishing returns.

## Plan Rules Cordia Can Code

Notation: `D` = days until the test, `R_exam` = FSRS-predicted recall on the test date, `w` = topic exam weight (from the syllabus or Canvas; equal weights if unknown).

**A. Universal rules (all horizons)**
1. Every study item's first exposure is followed by a retrieval attempt with immediate corrective feedback (show the answer and explanation after every miss). *Strong.*
2. If an item's recent first-try success is ≤ 50%, show a worked answer or explanation before the next retrieval. Don't let the student fail repeatedly without feedback. *Strong (Rowland 2014).*
3. Count an item as "session-learned" after 1 correct recall in a session. Initial learning targets 3 correct recalls. An item is "exam-ready" only after correct first-try recall in **≥ 3 separate sessions on different days**. *Strong (successive relearning).*
4. Only typed, spoken or explained recall can promote an item to Mastered. Recognition (multiple choice, card flips) can't. *Strong (overt > covert).*
5. Problem-solving topics (CS, quantitative business, dosage calculations, physics) practise with *new problem instances*, interleaving similar problem types once each type has been introduced. Fact-heavy topics (art history IDs, anatomy, legal elements) use cued recall plus "why" prompts. *Moderate.*
6. Don't introduce new interleaving on a topic until the student has had ≥ 1 blocked encounter with each category in it. *Moderate.*

**B. Horizon rules**

| Horizon | Sessions per item before test | Gap rule | Desired retention (FSRS) | Mock exams |
|---|---|---|---|---|
| D ≤ 3 | 2–3 (one per day; same-day repeats only for misses) | ~1 day | Ignore DR; target R_exam ≥ 0.90 on top-weight items | 1 short timed set (20–40 min) on D−1, not on test day |
| D ≈ 7 | 3 | 1–3 days | 0.90 | 1 full timed mock around D−3; short review quiz D−1 |
| D ≈ 14 | 3–4 | First review within 1–2 days, then 2–4 days | 0.85–0.90 until D−5, then 0.90–0.95 | 2 mocks: ~D−7 (diagnostic) and ~D−3; review quiz D−1 |
| D ≈ 30 | 4–5 | First review in 1–2 days, then widen to ~15–25% of time left (4–8 days) | 0.85 until D−10, ramp to 0.92–0.95 by D−3 | 2–3 mocks: ~D−14, ~D−7, ~D−3 |
| D ≈ 90 | 5–6 | First review in 1–3 days, then widen to ~10–15% of time left (1–2 weeks) | 0.80–0.85 until D−21, ramp to 0.90–0.95 by D−5 | 3–4 mocks: monthly, then D−7 and D−3 |

7. **Gap formula (default):** `next_gap = clamp(FSRS_interval(DR_current), 1 day, max(1, f(D_remaining) × D_remaining))`, where `f = 0.30` if D_remaining ≤ 7, `0.20` if ≤ 30, `0.12` if ≤ 90, `0.07` beyond. If unsure, round gaps *up*: too long costs less than too short.
8. **Deadline cap:** never schedule an item's next review after the test date. If the interval would pass the test, schedule the review so the item is seen in the final 1–4 days with R_exam ≥ target.
9. **Desired-retention ramp (engineering default, not directly tested):** `DR(D) = 0.85` if D > 21; linear ramp to `0.92` at D = 7; to `0.95` at D = 2. Never exceed 0.95 for scheduling. Above that, workload explodes, and the final-review rule (below) handles the last mile.
10. **Load smoothing:** run an FSRS workload simulation each night. If projected daily load in any of the last 5 days is > 1.5× the student's 14-day average, pull reviews earlier (lower DR on low-weight items, start the ramp sooner) rather than piling them up at the end.

**C. Mock exams**
11. Mock count: `min(4, max(1, floor(D/7)))`. Space them ≥ 3 days apart. The last *full-length* mock is on D−2 to D−4, never on test day. *Weak evidence; engineering default.*
12. Mocks copy the real exam's format, timing, item types and (if possible) closed-book conditions. Format matching gives a modest boost. *Moderate.*
13. After each mock, feed every miss and every "Guess" answer into Study now as priority items. Review explanations within 24 hours. *Strong (feedback).*
14. On D−1, give a short (10–20 min) mixed review quiz on top-weight topics, tuned to an expected success rate of about 75–85%. Easier final practice reduces anxiety, and success above 75% gives the largest testing effect. *Moderate.*

**D. Daily sessions, breaks and fatigue**
15. Default session block: 25 min study / 5 min break (or 50/10 for students who opt in). Suggest a longer break of about 20–30 min after 3–4 blocks. *Weak–moderate.*
16. Spread study across days rather than lengthening single days. If the daily quota needs more than about 3 hours, warn the student and trigger triage (section F) instead of silently extending the day. *Engineering default; no good evidence on optimal daily total.*
17. Within a session, interleave due reviews of different topics. Put new-material blocks early in the session, when the student is freshest. *Moderate.*
18. If first-try accuracy drops ≥ 15 percentage points below the session's opening rate, or response times rise sharply, prompt a break or end the session. *Engineering heuristic.*

**E. Final 24–72 hours**
19. **D−3 to D−2:** no brand-new topics unless they carry high weight and are untouched (see triage). Focus on second and third relearning sessions, the last full mock, and fixing mock misses.
20. **D−1:** a short review quiz, re-retrieval of every top-weight item with R_exam < 0.90, and a brief self-explanation pass on the most-missed concepts. Finish study at least 1 hour before the student's usual bedtime.
21. **Test day:** an optional 10–15 min light warm-up on high-confidence material, plus a summary-sheet glance. Over a few hours, restudy is fine (Roediger & Karpicke's short-delay crossover). No new material and no hard mocks.

**F. Sleep protection**
22. Never schedule study blocks in the student's normal sleep window. If a student is studying after midnight within 72 hours of a test, Cordia should say plainly, by SMS or in the app: "Sleeping now will help tomorrow more than another hour." *Strong.*
23. Cap planned daily load so the plan never needs less than 7 hours of sleep. If it would, run triage instead. *Strong (restriction ≈ deprivation).*
24. Encourage a study session before sleep on new material, and a retrieval session the next morning. *Moderate.*

**G. Triage when time is short** (trigger when the required sessions × items exceed the capacity left before D)
25. Priority score per item: `priority = w_topic × (1 − R_now) × learnability`. `learnability` is high for items with some past success or that are "Familiar", and low for repeated total failures. *RPL logic + expected value.*
26. Order: (a) high-weight items never attempted — one retrieval with feedback each, for breadth; (b) high-weight items that are Learning/Familiar — push to exam-ready; (c) medium-weight items; (d) the hardest low-success items last.
27. Drop or postpone items already at R_exam ≥ 0.95 except for one final check.
28. With D ≤ 2 and big gaps, coverage beats mastery. Aim for one successful retrieval of every high-weight idea rather than full mastery of a subset. Tell the student honestly what is being skipped.
29. Never triage away sleep (rule 23).

## What NOT to Do

- **Don't count rereading, highlighting or summarizing as study progress.** Dunlosky et al. rate them low utility. In one survey, highlighting was *negatively* correlated with exam scores (r = −.23).
- **Don't let flips or multiple choice certify mastery.** Recognition feels like knowing but gives weaker retention than producing the answer.
- **Don't test without feedback when the student is mostly failing.** Below about 50% success without feedback, testing gives roughly zero benefit.
- **Don't treat three correct answers in one sitting as learned.** Spread the correct answers across days.
- **Don't plan a cram the night before.** It works only for the next few hours and collapses within days. An all-nighter cuts encoding of everything studied that night (g = 0.62).
- **Don't schedule an all-nighter or a 5-hour sleep "for the last push".** Restricted sleep harms memory about as much as no sleep.
- **Don't assume "learning styles" matter.** No adequate evidence supports matching to visual or auditory types (Pashler 2008). The 2024 meta-analysis judged the effects "too small and too infrequent to warrant widespread adoption."
- **Don't interleave unrelated subjects or first-time expository reading.** Interleaving helps with *confusable* categories and problem types, and can hurt for plain text and word lists.
- **Don't push desired retention to 97–99%.** Workload rises sharply for little gain. Use a targeted final review instead.
- **Don't schedule reviews after the exam date, or let reviews pile up in the last 48 hours.**
- **Don't give a hard, full-length mock on test day.** Hard practice raises anxiety more than easy practice.
- **Don't trust students' feeling of fluency.** Restudy raised confidence in Roediger & Karpicke while producing worse one-week recall. Use measured first-try accuracy instead.

## Caveats

- Most spacing-ratio numbers come from Cepeda et al. (2008), a foundational study using trivia-like facts. Horizons other than 1 week and 1 year are interpolated. Complex conceptual or procedural material is less studied.
- In mathematics, the classic testing effect is not reliable in the current meta-analytic evidence (only 7 studies). Spacing is better supported there.
- The srs-benchmark measures *prediction* on Anki data, not learning outcomes. Cordia's typed, AI-graded, multi-format reviews differ from Anki button presses, so FSRS parameters should be refit on Cordia's own logs.
- Mock-exam count and timing, the desired-retention ramp, session length and the break rules are engineering defaults built from adjacent evidence, not tested prescriptions. They should be validated with Cordia's own delayed-recall and grade data.
- Some quoted figures (Anki SM-2 benchmark row, after-learning sleep effect g = 0.28, FSRS interval example) come from reputable secondary write-ups of primary sources rather than the primary tables.

## What Cordia Should Do

**Learn mode**
- Keep recall-only mastery. It matches the overt-retrieval evidence.
- Change "Mastered" to require correct first-try recall in **≥ 3 separate study days**, not just in one round. Within a day, keep the current "misses return later in the round" rule, since it gives each miss its feedback-plus-retry.
- Replace the fixed 5-day fade with FSRS retrievability. Show "Mastered" only while R ≥ the current DR target.
- Change the daily quota so everything is *exam-ready* (3 spaced sessions) by D−1. That means it must start relearning cycles early instead of mastering everything the day before. Make readiness % = weighted mean of `R_exam` across items, using topic weights.
- Add an optional "explain why" prompt (AI-checked) after a correct typed answer on concept or procedure items. That gives the self-explanation boost of g ≈ 0.4–0.55. Skip it for pure facts.

**Flashcards**
- Retire fixed Leitner boxes (1, 2, 4, 7, 15, 30). They can't produce calibrated predictions and ignore the test date. Use FSRS-6 with default parameters at first, then refit per user (or per course) once there are about 1,000 reviews.
- Apply the deadline cap and DR ramp (rules 7–10).
- Treat flips as recognition. Offer a "type it" toggle and give typed answers more weight in FSRS updates.

**Quiz**
- Keep "first tries count". It is a good proxy for delayed recall.
- Change "a miss must be answered right 2 more times about 3 questions apart" to **1 more correct today + 1 correct in each of the next 2 study days** (cross-session relearning).
- Add quiz formats that mirror the exam. For example, in NCLEX mode use select-all-that-apply and prioritisation items.

**Practice**
- For problem-solving courses, generate *new instances* of each problem type and interleave types once each has been seen once.
- Require a short written self-explanation of the key step on misses. Show a worked solution after any miss before the next attempt.
- Build **mock exams** here: timed, exam-format, scheduled by rule 11, with misses and "Guess" answers fed into Study now.

**Study now**
- Order the queue by the triage priority score (rule 25): due items with low `R_exam` and high weight first, then quiz and mock misses, then new items in the student's proximal zone, then the hardest low-success items.
- Use 25/5 blocks by default, with the fatigue-based stop rule (rule 18).
- In the final 72 hours, switch to "exam mode": no new low-weight items, a D−1 review quiz, and a test-day warm-up only.

**Confidence ratings (Sure / Think so / Guess)**
- Count a correct "Guess" as a *miss* for scheduling (low stability). Prioritise "Sure but wrong" items for an explanation-first review.
- Show calibration (confidence vs accuracy) on the readiness screen to counter the feeling of fluency. This design is a reasonable use of metacognition research but hasn't been tested in Cordia; A/B test it.

**SMS assistant**
- Send reminders timed to scheduled relearning sessions, not generic nudges. For example: "3 nursing pharm cards fade below 90% tomorrow — 6 min now?"
- Send sleep-protection messages (rule 22) and a D−1 evening message: "Short review quiz, then sleep."
- Use Canvas data to send triage alerts when the projected load exceeds capacity ("Exam in 4 days; here's the 60% that matters most").

**Planned FSRS engine and bandit**
- Model each item with FSRS-6 stability, difficulty and retrievability. Map typed/AI-graded, recognition and confidence signals to grades, and refit on Cordia logs. Evaluate with log loss and RMSE(bins) on held-out reviews, as the srs-benchmark does.
- Schedule with a deadline-aware objective: maximise Σ `w_i × R_i(exam_date)` under a daily time budget. Use the DR ramp as the default policy, and run the workload simulator every night for load smoothing.
- Reward the contextual bandit on **delayed** outcomes: first-try recall ≥ 2 days later and Canvas exam scores, not same-session accuracy. Immediate performance can reward the wrong strategies, such as massing (Roediger & Karpicke crossover).
- Constrain the bandit with the hard rules from this report (sleep window, ≥ 3 sessions per item, feedback after misses). That way exploration can tune parameters such as gap ratio, DR ramp, block length and interleaving share, but can't learn to cram.
