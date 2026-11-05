# Personalizing Cordia Classroom: Which Short Measures Predict Study Behaviour, Retention and Outcomes, and How to Ask Them

**Bottom line:** Ask very little about personality in onboarding. The strongest cheap predictors are a single "what grade do you expect?" question (performance self-efficacy, the largest non-cognitive correlate of GPA in meta-analysis) and what the student *does* in the first 2–3 minutes: whether they finish a guide and how well their confidence matches their accuracy. Everything else (conscientiousness, procrastination, exam nerves, chronotype) predicts outcomes only weakly to modestly. It should be collected lightly over days 2–7, and only where it changes what Cordia does.

## TL;DR

- **Predictors ranked by value per question:** performance self-efficacy / grade expectation (r = .59 with GPA) and effort regulation (r = .32) beat traits. Conscientiousness, procrastination (r ≈ −.13 to −.18), test anxiety (r = −.17 with GPA) and chronotype (r ≈ ±.15) are real but small. Growth-mindset measures (r = .10) and learning styles are close to useless for personalization.
- **Behaviour beats self-report:** self-reported metacognition is weakly or even negatively related to actual monitoring accuracy. Two days of usage logs predict disengagement with ~81% F1. Cordia's confidence × correctness × latency on the first 3–5 "Check yourself" items is a better calibration measure than any questionnaire.
- **The best onboarding "question" is a plan, not a measurement:** if-then implementation intentions ("When ___ happens, I'll open Cordia at ___") have medium-to-large effects across 642 tests. Given that 48% of Cordia's users never made a guide and 48% were active for one day, onboarding should be about 5 quick taps that end in a generated guide plus a scheduled first session, with no long survey.

## Key Findings

### 1. What actually predicts college grades

- **Richardson, Abraham & Bond (2012)** synthesized 1,105 correlations across 50 constructs. *This is older but still the main reference meta-analysis.* The strongest correlate of university GPA was **performance self-efficacy (r = .59)**, which is essentially the grade a student expects to get. It was followed by high-school GPA, ACT, **grade goal (r = .35)**, **effort regulation (r = .32)** and **academic self-efficacy (r = .31)**. Demographic and psychosocial context factors produced at best small correlations. **Evidence: strong.** One caveat: performance self-efficacy partly reflects students' accurate knowledge of their own past performance, so it is a strong *predictor* but not necessarily a lever.
- **Conscientiousness:** Mammadov's 2022 meta-analysis (Journal of Personality) found that cognitive ability plus personality explained 27.8% of the variance in academic performance. Conscientiousness was "a strong and robust predictor" even after controlling for ability, accounting for 28% of the explained variance. A 2025 study of college GPA found that conscientiousness added incremental validity (observed r = .17) beyond g. In a regression with high-school GPA, however, its β fell to about .06. A 2026 ScienceDirect study found "mixed results", with conscientiousness non-significant in one of two samples. **Evidence: strong that it predicts; modest in size; much of the effect runs through prior achievement and self-efficacy.**
- **Procrastination:** Kim & Seo (2015; 33 studies, 38,529 participants) found a weighted mean r = −.13. The relationship was weaker when both measures were self-reported, and "the use of self-report scales interfered with detection" of the link. A 2024 meta-analysis in *Education Sciences* (96 articles, 55,477 participants) found r = −.18 overall. Passive procrastination was negatively related to performance, while so-called *active* procrastination had a small positive relation. **Evidence: strong for a small negative effect.** Behavioural delay (when a student actually starts relative to a deadline) is the more valid signal, and Cordia can see it through Canvas.
- **Test anxiety:** von der Embse et al. (2018; 238 studies) found test anxiety correlates **r = −.17 with GPA** and **r = −.26 with standardized exams**, with effects ranging from −.13 to −.40. Citing earlier work (Putwain & Daly, 2014; Thomas et al., 2017), von der Embse et al. report that between 15% and 22% of students show high levels of test anxiety. **Evidence: strong for a small-to-moderate negative effect.** The gap with standardized exams matters for Cordia's NCLEX/MCAT/bar paths. A 2022 *Oxford Review of Education* study cautions that it is "less clear the extent to which this is due to selection bias, with academically weaker pupils displaying higher levels of anxiety."
- **Chronotype:** Preckel et al. (2011 meta-analysis; *older but still the main evidence*) found morningness correlated **r = .16** and eveningness **r = −.14** with achievement, about 2% of variance. Eveningness was slightly *positively* related to cognitive ability (r = .08). Later meta-analyses (Tonetti et al., 2015, 31 studies, N = 27,309; Scherrer & Preckel, 2021, 23 studies) confirm a small association between evening preference and lower achievement. **Evidence: strong for a small effect.** The likely mechanism is misalignment with class schedules, not lower ability. For Cordia, this argues for *scheduling* study blocks to fit chronotype rather than treating evening types as weaker students.
- **Mindset:** Sisk et al. (2018) found the mindset–achievement correlation was **r = .10** and intervention effects averaged **d = .08**. Macnamara & Burgoyne (2023, Psychological Bulletin) found d = 0.04 (95% CI −0.01 to 0.10) in studies where the intervention actually changed mindsets (13 studies, N = 18,355), and d = 0.02 in the highest-quality studies (6 studies, N = 13,571). They attribute apparent effects partly to design flaws and bias. On the other side, Burnette et al. (2023) and Tipton et al. argue for meaningful effects in at-risk "focal" groups. The National Study of Learning Mindsets (Yeager et al., 2019, Nature; 12,490 ninth-graders in 65 schools) found lower-achieving students gained **B = 0.10 grade points** (95% CI 0.04–0.16), with larger effects in schools with supportive peer norms. **Evidence: contested; average effects near zero, possible small effects for struggling students.** I did not find a strong, recent, short validated attribution-style instrument with good predictive evidence for college grades, so attribution style is not well established here.

### 2. Short instruments, licensing and what shortening costs

- **Mini-IPIP** (Donnellan et al., 2006) has 20 items, 4 per Big Five factor, and is **public domain**. IPIP items "can be used for any purpose without asking permission and without paying a fee," including commercial use. Its Conscientiousness alpha is only .69. Cordia's Assistant already uses it, so reuse those 4 C items rather than adding a new instrument.
- **BFI-2-XS** (Soto & John, 2017) has 15 items, 3 per domain. Its authors report roughly **20% less reliability and validity than the full 60-item BFI-2**, and Soto & John's own table shows the BFI-2-XS retains 0.84 of the full BFI-2's domain-scale validity (0.93 for the 30-item BFI-2-S). I did not verify its licence terms for commercial use in this research, so check with the authors before shipping it. The Mini-IPIP's clear public-domain status makes it the safer default.
- **Procrastination:** the Pure Procrastination Scale (Steel, 2010) has 12 items. The 5-item Academic Procrastination Scale–Short Form correlated r = .79 with the Tuckman scale in a sample of 282 college students. The GPS-9 is another short trait measure. Given the self-report attenuation above, a single behavioural scenario plus Canvas submission timing is a reasonable replacement.
- **Test anxiety:** the TAI-5 (Taylor & Deane, 2002) has 5 items and α = .87, balancing Worry and Emotionality. It is derived from the Spielberger TAI, which Mind Garden licenses commercially, so **assume TAI-5 items need permission** (this is my inference, not confirmed). The Westside Test Anxiety Scale has 10 items and was designed as a screener. Its validation reported correlations of .49 and .40 between anxiety reduction and test gains. Its licensing was not confirmed here.
- **Chronotype:** the rMEQ has 5 items. Its self-assessment item ("Are you a morning or evening type?") on its own classifies people into the same category as the full scale in a Portuguese validation. The MCTQ takes about 7 minutes and has test–retest rho = .905, but it is too long for onboarding. **A single item loses little here.**
- **Self-efficacy:** the MSLQ self-efficacy subscale (8 items) is the classic choice; I did not verify current licensing. Given Richardson's results, a single grade-expectation item ("What grade do you honestly expect?") captures the strongest predictor directly.
- **The general rule on shortening:** Allen, Iliescu & Greiff (2022) argue that well-designed single items can perform comparably to longer scales for **unidimensional, concrete** constructs, but are inappropriate for ambiguous ones. That favours single items for grade expectation, chronotype, time available and specific behaviours (e.g., "what do you do the night before?"). It argues against single items for broad traits like conscientiousness, where you should expect noticeably lower reliability. Scenario (situational-judgment) versions of these constructs are **not validated** against the original scales; treat them as Cordia-specific measures to be validated against Cordia's own outcome data.

### 3. Learning styles (meshing) do not justify personalization

- Pashler et al. (2008) set the test: a crossover interaction where each style learns best from matched instruction. *This is older but still the defining standard.*
- The most sympathetic recent meta-analysis (Clinton-Lisell & Litzinger, 2024, Frontiers in Psychology; 21 studies, 101 effect sizes, 1,712 participants) found a small pooled benefit (g ≈ 0.31). However, **only 26% of outcome measures showed the required crossover**, study quality was low, and the authors concluded the benefits are "too small and too infrequent to warrant widespread adoption." **Evidence: strong against meshing.**
- **Popular belief not supported:** "Visual learners learn more from diagrams." Cordia's optional learning-style preference should stay as a *comfort/format preference* for Explain views. It should never route students away from retrieval practice and should not be marketed as making learning more effective. Use instead: match format to *content* (diagrams for spatial/process material, worked examples for problems) and use retrieval, spacing and interleaving for everyone.

### 4. Behavioural measures beat self-report for metacognition and churn

- A 2025 study by Kit S. Double in *Behavior Research Methods* ("Survey measures of metacognitive monitoring are often false") found that "those who reported being better at metacognitive monitoring, in fact tended to be worse according to the online metacognitive ratings." A systematic review (Craig et al., 2020, *Metacognition and Learning*) concluded that self-reports "only weakly correlate with participants' metacognitive behavior." **Evidence: moderate-to-strong.** Calibration from confidence ratings is noisy with only 3 items, though. A 2024 *npj Science of Learning* study of 50 life-sciences undergraduates (Behrendt et al.) found that phi, meta-efficiency and confidence-bias scores did not predict course grades, while meta-d′ did. Treat early calibration as a prior that updates, not a verdict.
- **Early usage predicts churn:** Chen & Kizilcec (2020, EDM; 87,651 students, about 1.2 million quiz attempts on an SMS learning platform) found a classifier using **two days of activity** predicted disengagement with **F1 = 81.2%**. On that platform, **75% of students disengaged within two days of registering**, and students who later re-engaged had interacted more with quizzes early (56.0% vs 47.6%). Alamri et al. (2020) predicted MOOC dropout from first-week activity with 82–94% accuracy using only two features. **Evidence: moderate (consistent across platforms, but correlational).** Cordia's pattern (48% never made a guide, 48% active one day) fits this literature: the first session is the product.

### 5. Study strategies: students over-rely on rereading

- Karpicke, Butler & Roediger (2009; 177 students; *older, still the main evidence*) found 84% listed rereading and 55% ranked it first, while only 11% mentioned practising recall and 1% ranked it first. After reading once, 57% would reread and 18% would try recall. Hartwig & Dunlosky (2012) replicated the popularity of both self-testing (71%) and rereading (66%) and examined whether self-testing and scheduling relate to achievement. Free-report surveys find less retrieval use than checklist surveys (Frontiers in Education, 2024), so **how you ask changes the answer**. Dunlosky et al. (2013) rated practice testing and distributed practice as the highest-utility techniques and rereading and highlighting as low utility. **Evidence: strong.** This matches Cordia's "reading beats study modes" problem: students prefer what feels fluent.

### 6. Implementation intentions and WOOP

- Gollwitzer & Sheeran (2006; 94 tests; *older but foundational*) found **d = .65**, with academic goals around d = .72. Sheeran, Listrom & Gollwitzer (2024; **642 tests**) found **d = .27–.66** across outcomes, with **larger effects when plans use an if-then format, motivation is high, and plans are rehearsed**. A 2026 registered-report meta-analysis by Breitwieser & Reinelt in the *British Journal of Psychology* (42 studies, N = 12,957 children) found g = 0.31 (95% CI 0.21–0.41) for children, with high heterogeneity (I² = 65.2%). **Evidence: strong.**
- **MCII/WOOP** (Wang, Wang & Gai, 2021; 21 studies, 24 effects, N = 15,907) found **g = 0.336**, moderated by intervention style, with possible publication bias. **Evidence: moderate.**
- **For onboarding:** have the student pick a cue tied to their existing routine (after a specific class, at a specific time) and a tiny first action ("do 5 Learn questions"). Then put it into Google Calendar and the SMS Assistant. Re-surfacing the plan is the "rehearsal" that increases effects.

### 7. Ethics

- **Indirect questions:** scenario items are fine if the student is told what they are for. A short "why we ask" line on each screen avoids the deceptive-design problem and does not reduce usefulness. Never claim a personality "type" from 1–2 items; call results "starting settings".
- **Stereotype threat:** Stricker & Ward (2004) moved demographic questions after the AP Calculus exam. Danaher & Crandall's (2008) reanalysis estimated about 4,700 more women a year would earn AP credit, but a 2022 PLOS ONE conceptual replication concluded the change is not a "silver bullet." **Evidence: contested.** The cheap precaution is still worth taking: **never ask gender, race or first-gen status right before the "Check yourself" diagnostic**, and don't ask them at all unless needed.
- **Anxiety and mental-health-adjacent data:** ask about "exam nerves" as an opt-in, skippable question on day 3+, not at signup. Store it separately, never show it to instructors, let students delete it, and don't use it for marketing. Keep the existing 988 crisis screen. Escalation language should point to campus counseling, not diagnose.
- **Under-18 users:** the FTC's amended COPPA Rule took effect June 23, 2025, with full compliance required by April 22, 2026. It covers under-13s; for school-authorized use, data may be used **only for educational purposes**, not commercial ones. FERPA obligations generally flow through institutions to vendors handling education records such as Canvas grades. Get counsel before any high-school launch; this research does not substitute for legal review.

## Table of Constructs

| Construct | What it predicts | Evidence | Best short instrument (items; licence) | Shortened version for Cordia |
|---|---|---|---|---|
| Performance self-efficacy / grade goal | GPA (r = .59 / .35) — strongest non-cognitive correlate | Strong (older meta-analysis) | MSLQ self-efficacy (8; licence unverified) | 1 item: "What grade do you honestly expect?" + "What are you aiming for?" Little loss: it is a concrete construct |
| Effort regulation | GPA (r = .32) | Strong | MSLQ effort regulation (licence unverified) | Measure behaviourally: sessions completed vs planned |
| Conscientiousness | GPA, incremental over ability; modest | Strong (small–moderate) | Mini-IPIP C (4; public domain); BFI-2-XS (3 of 15; ~20% less validity, licence to check) | Reuse the Assistant's 4 Mini-IPIP items; a 1-item scenario is unvalidated |
| Procrastination (passive) | Lower performance (r ≈ −.13 to −.18) | Strong (small) | PPS (12), APS-S (5), GPS-9 | 1 scenario + Canvas submission timing (behaviour is more valid) |
| Test anxiety | GPA r = −.17; standardized exams r = −.26 | Strong | TAI-5 (5; likely requires Mind Garden permission); WTAS (10; licence unconfirmed) | 1–2 opt-in "exam nerves" items on day 3+; screening only, not diagnosis |
| Chronotype | Achievement r ≈ .16/−.14; mainly a scheduling signal | Strong (small) | rMEQ (5); MCTQ (~7 min) | rMEQ self-assessment item alone — validated to classify similarly |
| Mindset / attributions | r = .10 with achievement | Contested | Dweck implicit-theory items | 1 setback scenario, used only to pick feedback tone, not to predict |
| Metacognitive calibration | Learning efficiency; self-reports weak or negative | Moderate–strong for behaviour over self-report | Confidence–accuracy on items (gamma, bias, meta-d′) | Sure/Think so/Guess on 3–5 Check-yourself items, updated continuously |
| Current study strategies | Rereading dominant; retrieval and spacing predict better learning | Strong | Hartwig & Dunlosky checklist | 1 forced-choice scenario ("night before…") |
| Time available | Constrains plan feasibility; no strong predictive meta-analysis found | Weak (practical) | None standard | 1 item: minutes per weekday; verify against usage |
| Learning style | Meshing not supported | Strong against | VARK etc. — do not use for routing | Keep as optional format preference only |
| Implementation intention (intervention) | Goal attainment d = .27–.66 | Strong | If-then plan prompt | 1 screen: cue + place + first tiny action |

## Draft Question Bank (scenario-style)

Each item lists: options → what it measures → what Cordia changes.

**Q1. "Your next big exam — when is it?"** (Pre-filled from Canvas; confirm or pick.)
Options: date picker / "No exam yet — just keeping up".
Measures: goal proximity (context, not a trait).
Cordia changes: sets the Learn test date and readiness target and seeds the study plan length. With no exam, it defaults to Flashcards spaced review on recent modules.

**Q2. "Be honest — what grade do you expect on it right now?"** (A / B / C / Not sure)
Then: **"And what are you aiming for?"**
Measures: performance self-efficacy and grade goal.
Cordia changes: the gap sets plan intensity (daily minutes, Learn ladder depth). Low expectation plus high goal flags "high-support" (more frequent check-ins, smaller first tasks, early wins shown). "Not sure" triggers a diagnostic-first plan. Re-ask after each Canvas grade to update the Bayesian profile.

**Q3. "It's the night before a quiz. What are you most likely doing?"**
a) Rereading notes/slides  b) Highlighting or rewriting notes  c) Quizzing myself or doing flashcards  d) Doing practice problems  e) Honestly, starting from scratch
Measures: current strategy (retrieval vs restudy) plus a hint of cramming.
Cordia changes: a/b → show a 60-second "rereading feels good but quizzing sticks" explainer and open the first guide in Quiz/Learn with Notes one tap away, instead of reading-first. c/d → go straight to Learn/Practice. e → front-load spacing reminders via SMS and schedule shorter, earlier blocks.

**Q4. "A paper is due in 10 days. When do you usually start?"**
a) Day 1–2  b) Around the middle  c) The last 2–3 days  d) The night before
Measures: passive procrastination (scenario version; unvalidated, to be checked against Canvas submission timing).
Cordia changes: c/d → break plans into daily 10-minute chunks, send the first nudge earlier (e.g., 7 days out), and use streak freezes generously. a/b → fewer, longer blocks. Overwrite this answer with observed Canvas behaviour after 2–3 assignments.

**Q5. "If you could pick, when does your brain work best?"**
Definitely morning / Somewhat morning / Somewhat evening / Definitely evening
Measures: chronotype (rMEQ self-assessment item).
Cordia changes: places Google Calendar study blocks and SMS reminders in the student's peak window, inside quiet hours. For evening types, schedules the hardest Learn recall work in the evening and light Flashcards in the morning.

**Q6. "Pick your study trigger: right after ___ I'll open Cordia ___."**
Cue options: after a specific class (from Canvas schedule) / after dinner / on the bus or train / before bed / custom. Place: library, room, commute.
Measures: nothing; this is an implementation intention (intervention).
Cordia changes: creates a recurring calendar block and an SMS that quotes the student's own words ("Right after Bio lecture → 5 Learn questions"). Re-shows the plan weekly (rehearsal).

**Q7. Check yourself (behavioural): 3–5 questions from the student's own material, each with Sure / Think so / Guess.**
Measures: prior knowledge, calibration (overconfidence = many "Sure" errors; underconfidence = many correct "Guess"), and latency.
Cordia changes: sets FSRS initial difficulty per item and priors on the learner profile. Overconfident → more Quiz items with format-switching on misses and "predict your score" prompts. Underconfident → show accuracy trends ("you were right on 4 of 5 you called Guess") and move faster up the Learn ladder.

**Q8 (day 2). "How much time can you realistically give on a normal weekday?"** 10 / 20 / 30 / 45+ minutes
Measures: time available (constraint).
Cordia changes: caps the daily plan, and if the exam plan needs more, shows the trade-off explicitly. Compare with actual usage after a week and re-ask if they diverge by 2× or more.

**Q9 (day 2–3, from the Assistant's existing Mini-IPIP). "Which sounds more like you: 'I get chores done right away' or 'I often forget to put things back'?"**
Measures: conscientiousness (Mini-IPIP items).
Cordia changes: low C → more structure (fixed daily plan, checklist, SMS on the planned day). High C → more autonomy (a flexible weekly target). Use as a bandit prior only, and let behaviour dominate within 1–2 weeks.

**Q10 (day 3, opt-in). "When an exam starts, how do you usually feel?"**
a) Pretty calm  b) Some nerves, but they help  c) My mind goes blank sometimes  d) I'd rather skip this one
Then, only if c: "Want a few tools for exam nerves?" (yes/no)
Measures: test anxiety screen (worry/interference), not a diagnosis.
Cordia changes: c → add timed practice under exam-like conditions in Quiz with gradual time pressure, encouraging framing after misses, and pre-exam SMS with a short breathing/reappraisal tip. Never mention anxiety in instructor-facing views. If later free-text in the SMS Assistant suggests crisis, the existing 988 screen applies. d → store nothing.

**Q11 (day 4). "You studied hard and got a C. What's your first thought?"**
a) I need a different way to study  b) The test was unfair  c) Maybe I'm just not good at this subject  d) I'll just work harder at the same thing
Measures: attribution/mindset tendency (scenario; unvalidated).
Cordia changes: tone and content of grade-linked feedback only. c → strategy-focused messages ("Students who switched from rereading to Quiz on Unit 3 improved…" using the student's own data when available). a/d → show which modes correlated with their best grades. Do not predict outcomes from this item.

**Q12 (day 5). "For hard topics, which helps you start?"** Diagram / Listen / Notes / Real-life example / Mix
Measures: format preference (not a learning style).
Cordia changes: which Explain view opens first. Always follow with retrieval (Learn/Quiz) regardless of choice.

**Q13 (day 5–6, WOOP). "What's most likely to get in the way of your plan this week?"** Too tired / Other classes or work / Phone or social media / Forgetting / Not sure where to start
Measures: anticipated obstacle (mental contrasting).
Cordia changes: generates an if-then backup ("If I'm too tired after work, then I'll do 5 Flashcards in bed") sent by SMS on predicted risk days, and adjusts the bandit arms (e.g., shorter sessions for "too tired").

**Q14 (day 7). "Quick check: was this week's plan too much, about right, or too little?"**
Measures: plan fit (state).
Cordia changes: rescales next week's load ±25% and logs it against Canvas outcomes for the feedback loop.

**Q15 (major-specific, onboarding or day 2). "Is a licensing or entrance exam in your future?"** NCLEX / MCAT / LSAT / Bar / CPA / ACT / Not yet
Cordia changes: offers the matching premade expert-verified path and adds it to the dashboard default for that major.

## Recommended First-Week Sequencing

**Onboarding (target under 2 minutes, ending with a usable guide):**
1. Major + year (2 taps; drives the default dashboard layout).
2. Upload or pick a Canvas module, and **start generating the guide immediately** in the background.
3. Q1 exam date (Canvas pre-filled) → Q2 expected/target grade.
4. Q3 night-before strategy.
5. Q5 morning/evening.
6. Q7 Check yourself (3 items, with confidence) as the guide finishes.
7. Q6 if-then trigger → creates calendar block + first SMS.

That is 5 questions plus the behavioural check and the plan. Q4 can replace Q5 for students with no exam date. Do not ask demographics, anxiety or personality items here.

**Days 2–7 (one question per day, delivered in-app after a completed session or via SMS within quiet hours):**
- Day 2: Q8 time available; Q15 if not asked.
- Day 3: Q9 conscientiousness (existing Mini-IPIP flow); Q10 exam nerves (opt-in).
- Day 4: Q4 procrastination scenario (if not asked); Q11 setback scenario.
- Day 5: Q12 explain preference; Q13 obstacle (WOOP).
- Day 6: refresh the if-then plan (rehearsal).
- Day 7: Q14 plan fit + a short "here's what we learned about how you study" summary that the student can edit.

## Caveats

- Most correlations here are small (r = .10–.20). No onboarding quiz will "know" a student; its job is to set reasonable starting defaults and get the student studying.
- Scenario items (Q3, Q4, Q11, Q13) are Cordia-designed and **unvalidated**; validate them against behaviour and Canvas grades before relying on them.
- Licensing for BFI-2-XS, MSLQ, WTAS and TAI-5 was not fully confirmed; the Mini-IPIP is the only instrument here with a clear public-domain status.
- Churn evidence comes from MOOCs and an SMS learning platform, not from Cordia's own population; it is correlational.
- With 77 users, Cordia cannot yet learn "what works" per individual from grades. Canvas grades are few per term and confounded by course difficulty, so the feedback loop needs heavy pooling across students and should be framed as suggestions.

## What Cordia Should Do

1. **Rebuild onboarding around "first guide in under 2 minutes."** Start guide generation as soon as material is chosen and ask the 5 questions while it builds. Success metric: % of signups who complete a guide on day 0 (currently about 52%) and % active on day 2 (currently about 52% active more than one day).
2. **Make Check yourself the calibration engine.** Require a confidence rating on the first 3–5 items. Compute bias (overconfidence) and resolution, combine them with latency, and feed them as priors into the Bayesian learner profile and FSRS initial difficulty. Show students a one-line calibration insight; this is the "friendly quiz" payoff.
3. **Replace self-reported metacognition and learning-style routing with behaviour.** Keep the learning-style preference only as the default Explain view, relabelled "How do you like things explained first?", and always follow it with retrieval. Remove any claim that matching style improves learning.
4. **Ask grade expectation and target (Q2) and re-ask after every Canvas grade.** This is the single highest-value predictor and an ongoing calibration signal (expected vs actual grade).
5. **Ship if-then planning as a core feature.** Turn Q6 into a Google Calendar block plus an SMS that quotes the student's own plan, re-shown weekly. Add the WOOP obstacle (Q13) on day 5 to generate backup plans. A/B test this against a plain reminder; your retention gain is the outcome metric.
6. **Close the reading gap with defaults, not lectures.** For students who answer "reread/highlight" (Q3), open the first guide in Learn/Quiz with Notes one tap away, and show a 60-second explanation of why recall beats rereading. Make the bandit's reward (delayed recall) visible to students as "what stuck."
7. **Use Canvas behaviour to overwrite self-report.** After 2–3 assignments, replace the procrastination scenario score with observed submission timing, and use actual session times to correct chronotype scheduling.
8. **Set the bandit up honestly.** Use onboarding answers only as weak priors and let observed behaviour dominate within 1–2 weeks. For the grade feedback loop, pool across students (hierarchical model), compare within-student across courses or units, and present findings as "for you, Quiz weeks preceded better grades (low confidence)" until there is enough data.
9. **Handle sensitive data carefully.** Exam-nerves questions are opt-in, day 3+, skippable, stored separately, never instructor-visible, and deletable. Never ask demographics before the diagnostic. Add a "why we ask" line to every question and an editable "your study profile" page. Keep the 988 screen and quiet hours.
10. **Gate high-school expansion on legal review.** The amended COPPA Rule (compliance April 22, 2026) and FERPA obligations through institutions apply. Design an under-13 block and school-authorized "educational purposes only" data handling before any K-12 launch.
11. **Premade exam paths:** for NCLEX, MCAT, LSAT, bar, CPA and ACT, start each path with a diagnostic, use timed exam-condition practice (relevant because test anxiety correlates more strongly with standardized exams), and make the path the default dashboard tile for matching majors (nursing → NCLEX).
12. **Instrument and validate.** Log every onboarding answer against day-2/day-7 retention, mode use and Canvas grades. Drop any question that does not change a decision or predict anything after about 500 users.
