# Cordia Classroom: What Drives Day-1, Day-7 and Day-30 Retention in Study Apps, and How to Onboard and Personalize for It

Cordia's retention problem right now is activation, not personalization. 37 of 77 accounts never made a study guide, and reading sessions outnumber quiz sessions roughly 38 to 1 (716 vs 19). The evidence most strongly supports one move: get every new student to a first *recall* win on their own course material, tied to a real exam date, inside the first session. Then use a small number of relevant, forgiving reminders to bring them back. Heavy personalization, editable dashboards and streak pressure come after that, and the research on them is weaker than their popularity suggests.

## TL;DR
- **Benchmarks.** Education is one of the weakest retention categories. Cross-vendor 2024–2026 data puts mobile education D1 at about 18–28%, D7 at about 9–18% and D30 at about 2–8%, depending on methodology. Amplitude's 2025 Product Benchmark Report says a 7% day-7 return rate is already top-quartile across 2,600+ companies. Cordia's own early cohort (34 of 71 active users came back on a second day) is not the problem. The problem is the 37 accounts that never reached a study guide.
- **What works.** Fast time-to-value (value before signup walls), a short goal-oriented setup feeding an immediate "made for you" artifact, and forgiving streak mechanics (freezes, repair) have moderate evidence from Duolingo A/B tests and lab studies. Learning-style questionnaires, choice-heavy dashboards and high-volume texting do not. At-scale SMS nudge studies in education mostly found null effects. Course-specific, two-way texting from a trusted source did raise grades in a Georgia State RCT.
- **Testing at Cordia's volume.** At about 40 signups a month, a classic A/B test on D30 retention is not feasible: detecting a 10-point lift from a 25% baseline needs about 650 users. Use a leading-indicator primary metric (first-session recall activation, then D7 return), test only large swings, analyze with Bayesian probability-of-improvement plus a 10–20% long-run holdout, and pair every test with 5–8 student interviews.

## 1. Key Findings with Evidence Ratings

### 1.1 Retention benchmarks (2024–2026)

| Source (methodology) | Scope | D1 | D7 | D30 | Notes |
|---|---|---|---|---|---|
| Amplitude 2025 Product Benchmark Report | 2,600+ companies / 10,600+ products, mostly web and SaaS | Top 10%: ~21%; median ~5% | Top 10%: ~12%; 7% = top quartile | Month 1: 26% top 10%, 6.5% median | "Activation" = return on that day after first use. Not a mobile install metric. |
| Mixpanel 2024 Benchmarks Report | 7,700+ companies | — | Average week-one retention fell from 50% to 28% in 2023 | — | Week-based, all industries |
| OneSignal 2024 (cited by Stream, 2026) | Mobile, push-enabled apps | Education 27.5% | 17.76% | 8.02% | Sample skews toward apps that use engagement tooling, so it reads high. |
| MWM US Q3 2025 (cited by Fyresite) | Mobile, strict N-day | Education and knowledge 24.9% | 8.6% | 3.6% | All-app median: 27.3 / 9.2 / 3.9% |
| Business of Apps (2026 page) | Mobile, aggregated | — | — | Education ~2% | "One of the lowest rates across all app sectors" |
| Adjust (2023 blog) | Mobile education | 18% | D3 ~11% | — | Older but first-party Adjust data |
| Adjust Mobile App Growth Report 2025 | Composite "Growth Score" | — | — | — | Education scored 19.3, among the lowest categories |

**What this means.** The numbers diverge by 3–4x because of methodology: strict "returned on exactly day N" versus "on or after," installs versus signups, and push-enabled apps versus everything. Always state which definition you use. For a web-first study tool, the Amplitude framing (did the user come back on day 1 / day 7 after first use?) is the most comparable. A D7 return rate of 10–15% would be good for Cordia, and anything above 20% would be excellent. **Evidence: moderate.** The vendor datasets are large but proprietary, and their definitions differ.

**Popular belief not supported:** Claims like "X% of users churn in the first 3 days" usually come with no traceable dataset. The closest sourced versions are Amplitude's finding that the median product's day-1 return is about 5%, and Adjust's education D1 of about 18% falling to about 11% by D3. Cite those, not the floating statistic.

### 1.2 Early activation predicts long-term retention
Amplitude's 2025 report found that "69% of top day seven performers were also top three-month performers." It found no meaningful relationship between acquisition and retention. Top performers lose nearly half their activated users between Day 1 (21%) and Day 7 (12%). **Evidence: moderate.** The data is correlational and comes from a large vendor dataset. It does not show that activation causes retention, but it supports activation as a leading indicator.

### 1.3 Time-to-first-value: value before walls
- Duolingo lets people do a lesson before creating an account. In a First Round Review interview, Gina Gotthilf, Duolingo's VP of Growth, said "simply moving the sign-up screen back a few steps led to about a 20% increase in DAUs" (that first test predated her tenure). She also said later optimization of the hard and soft walls "yielded an 8.2% increase in DAUs."
- The common "first value in under 60 seconds" target comes from vendor blogs, not studies. The principle is sound but the number is a heuristic.
- **What the first value moment should be for Cordia:** the student answers a recall question from *their own* uploaded material, gets it right or gets useful feedback, and sees it placed against *their* exam date. Reading a generated guide feels useful, but reading is recognition, not recall. Cordia's usage (716 reading sessions vs 19 quiz and 10 flashcard sessions) shows students are stopping at the passive step.

**Evidence: moderate** for value-before-signup (Duolingo A/B tests, one company). **Weak** for specific second-count targets.

### 1.4 Personalized onboarding and "made for you" reveals
- The best public evidence is vendor-reported A/B tests. Adapty reports that an education app testing lesson-only, survey-only and survey-plus-lesson onboarding found survey-plus-lesson won with a 25% increase in trial starts. A productivity app that added personalization questions and a "customizing your experience" screen saw +8.5% trial starts and +17% paying conversions. These are unpublished, have unknown sample sizes and come from a vendor with an interest in onboarding tooling.
- Statistics like "personalizing the first session boosts 30-day retention by 25%" or "MyFitnessPal +28% D1" circulate on agency blogs without traceable primary data. **Do not rely on them.**
- The mechanism with better support is asking about goals, not traits. Duolingo's onboarding asks why you are learning and how much time you have, then sets a daily goal. Choice-overload research (below) shows that an articulated goal reduces overload.

**Evidence: weak to moderate.** The direction is consistent (survey plus immediate tailored artifact beats either alone), but no peer-reviewed RCT on onboarding personalization in study apps was found.

**Popular belief not supported: learning styles.** Pashler, McDaniel, Rohrer and Bjork (2008) concluded there is "no adequate evidence base to justify incorporating learning-styles assessments into general educational practice." A 2024 meta-analysis by Clinton-Lisell and Litzinger (21 studies, 101 effect sizes, 1,712 participants) reported a positive pooled matching effect, but few studies showed the crossover interaction Pashler's criteria require. The debate is ongoing, but nothing supports routing content by "visual vs auditory learner." Cordia's "indirect, research-backed questions" should measure *behaviors* (when they study, whether they self-test or reread, how far ahead they start, how confident they are). Those map onto modes Cordia already has. **Evidence against learning-style matching: strong (contested at the margins).**

### 1.5 Customizable dashboards: IKEA effect versus choice overload
- **The IKEA effect is real but conditional.** Norton, Mochon and Ariely (2012) found builders paid 63% more for a box they assembled. The effect "dissipated" when people failed to complete or destroyed their creations. A 2017 conceptual replication supported the effect and identified psychological ownership as the mechanism. A 2026 meta-analysis in *Psychology & Marketing* (55 effects, N=5,454) found a moderate overall effect (d=0.57).
- **Self-design raises valuation:** Franke, Schreier and Kaiser (2010) found self-designed T-shirts drew over 40% higher willingness to pay (€6.85 vs €4.75), and the effect was fully mediated by feelings of accomplishment.
- **But in software, most people do not customize.** Mackay's (1991) study of 51 users found "many people do not take advantage of the customization features at all." Lack of time was the top barrier, and users mostly borrowed customizations from colleagues.
- **When customization helps:** in McGrenere, Baecker and Booth's 2002 field study of a personalizable Microsoft Word (20 users, 6 weeks), 14 of 19 spent at least 50% of their time in their personal interface, and 65% preferred it. Satisfaction and sense of control improved mainly for "feature-shy" users. Findlater and McGrenere (CHI 2004) found static menus were faster than adaptive ones, while 55% of participants preferred user-controlled (adaptable) menus.
- **Choice overload is conditional.** Chernev, Böckenholt and Goodman's 2015 meta-analysis (99 observations, 7,202 participants) found overload depends on choice-set complexity, task difficulty, preference uncertainty and decision goal. A first-week student facing an empty, fully editable dashboard scores high on all four.

**Conclusion:** Defaults beat customization at the start. Ship a strong default per major (already a "made for you" artifact), make editing available but not required, and prompt one small edit only after the student has a success. None of these studies measured app retention, so "editable dashboards increase retention" is an extrapolation. **Evidence: moderate** that defaults matter and few users customize. **Weak** that customization drives retention. **IKEA-effect overreach** (claiming layout editing will create attachment) is not supported for software.

### 1.6 Names, explanations, and creepiness
- Sahni, Wheeler and Chintagunta (Marketing Science, 2018) ran field experiments with millions of emails. Adding the recipient's name to the subject line lifted opens 20% (9.05% to 10.80%) and leads 31%, and cut unsubscribes 17%. A 2024 replication (Defau) has been reported to qualify this finding, but I could not review its details. **Evidence: moderate**, with fading novelty likely.
- The "personalization–privacy paradox" (Awad and Krishnan, MIS Quarterly 2006) found consumers who value information transparency are *less* willing to be profiled. Later reviews consistently find that intrusive or overly visible inference feels "creepy," and that transparency and user control are the main trust levers. **Evidence: moderate**, mostly survey and lab work in marketing and e-commerce, not education.
- **Applied to Cordia:** explain recommendations using data the student *knowingly* gave or did ("Because your Bio 201 exam is Oct 14 and you missed 3 questions on cell respiration"). Avoid surfacing inferences they did not expect, such as grade drops, at the wrong moment or over SMS. Canvas grades are the most sensitive signal Cordia has. Show grade-linked insights only in-app, only after opt-in, and with a "why am I seeing this" link.

### 1.7 Streaks
- Duolingo's own A/B tests: a Streak Wager raised D1, D7 and D14 retention, with D7 up 14%. The Weekend Amulet raised D7 by 2.1% and D14 by 4%. **Evidence: moderate** (first-party, large-n, one product).
- Lab and field research by Silverman and colleagues: people treat an intact streak as a goal in itself. Broken streaks are "especially demotivating," most of all when people blame themselves, and the effect softens when a broken streak can be "repaired." Mehr, Silverman, Sharif, Barasch and Milkman (OBHDP, 2025) ran six pre-registered studies (total N = 4,504) and found people "complete more work when compensated with streak incentives than with larger, stable incentives." **Evidence: moderate** (multiple studies, mostly hypothetical or incentivized tasks).
- An IDB field experiment on a math platform (Aulagnon, Cristia, Cueto and Malamud, 2024) found highlighting streaks increased consecutive weekly use. It also raised the risk that broken streaks reduce motivation. **Evidence: moderate.**
- Vendor claims (for example, "freezes make streaks last 4.5x longer," from Trophy's own report) are **weak.**

**Cordia implication:** keep the weekly freeze, add a streak *repair* (do two sessions tomorrow), never message "you broke your streak," and measure streaks in study-days per week rather than strict consecutive days. College study patterns cluster around exams, and Duolingo's own weekend usage dips 5–10%.

### 1.8 Reminders, push and SMS
- **Notification content and novelty:** Duolingo's KDD 2020 paper (Yancey and Settles) shows recurring reminders suffer novelty decay, with new templates winning short-term and then fading. They built a "recovering" bandit to rotate content. Gains from optimizing content were small but meaningful at scale. **Evidence: moderate.**
- **Fatigue:** the widely repeated "46% disable push at 2–5 messages per week" figure traces to a 2016 Localytics/Research Now consumer survey, where 46% said two to five notifications a week would make them disable push and 32% said 6–10 a week would make them stop using the app. It is directionally plausible but **weak** as a 2025 benchmark.
- **SMS in higher education:** early small-scale texting RCTs worked. Castleman and Page's summer-melt texts raised college enrollment, especially for students without firm plans. National-scale versions produced null or slightly negative enrollment effects (Avery et al., 2021), and FAFSA campaigns were null at scale (Bird et al., 2021). Castleman (2021) attributes this partly to losing two-way advising and institutional trust at scale. **Evidence: strong** that generic one-way texts at scale do little.
- **What did work:** Georgia State's course chatbot RCTs (Meyer, Page and colleagues) sent 2–3 course-specific, two-way texts a week. Pooled across two trials, they raised the chance of earning a B or higher by 5–6 percentage points. In the microeconomics trial (1,568 students) course drops fell 3 points. In the American Government trial, B-or-higher rose 8 points and first-generation students' grades rose about 11 points on a 100-point scale. 92% of students recommended it. **Evidence: moderate** (RCT, one institution, course-embedded).

**Cordia implication:** the SMS assistant should behave like Pounce, not like a marketing blast. Messages should be tied to *this* course's Canvas dates, invite a reply ("Text 'quiz me' for 3 questions on Ch. 5"), stay at low frequency, and back off when ignored.

### 1.9 Personalized study plans and the grade feedback loop
No peer-reviewed evidence was found that consumer study apps can learn *individually* which behaviors raise *that* student's Canvas grade. With a handful of exams per student per term, individual-level causal learning is statistically implausible. Cordia can learn population-level associations (for example, "students who did at least 2 recall sessions spaced across 3+ days before an exam scored higher") and present them as observations, not promises. **Evidence: none found for individual-level learning; flag as an open question.**

## 2. Recommended Onboarding Flow for Cordia (target: about 5 minutes to first recall win)

| Step | What happens | Time budget | Why |
|---|---|---|---|
| 0. Landing to "New" | One button: "Turn your next exam into a plan." Account creation only via Google/school SSO, or deferred until after step 3 if technically possible. | ≤15 s | Value before walls (Duolingo delayed signup) |
| 1. Pick a source | New sheet: upload slides/PDF, paste lecture, **or "Connect Canvas"** (recommended badge). If Canvas: pick the course with the nearest exam. | 30–60 s | Their own material is the "made for you" artifact |
| 2. While the guide builds: 3 quick questions | (a) Which exam is this for, and when? Prefilled from Canvas. (b) Major and year (one screen). (c) One behavior question: "When you study, you usually… reread notes / make flashcards / do practice problems / test yourself." | 45–60 s (runs in parallel with generation) | Goal articulation reduces overload. Behavior beats "learning style." |
| 3. First recall win | Guide opens straight into **3 "Check yourself" recall questions** (not 5), with the confidence tag (Sure / Think so / Guess). Show the score plus "1 idea moved up your mastery ladder." | 60–90 s | Recall, not reading, is the activation event |
| 4. The "made for you" reveal | A one-screen plan: "Bio 201 exam in 12 days → 6 short sessions, next one tomorrow 7 pm, 10 min." Each item has a "why" line ("Because you marked 2 answers as Guess"). | 20–30 s | Explained personalization builds trust |
| 5. Opt in to the assistant | "Want a text the night before each session? Reply STOP anytime." Prefill the time from step 4. Make clear it is two-way ("text 'quiz me'"). | 15–20 s | Course-tied, two-way texting is the version with RCT support |
| 6. Optional, later | Chrome extension prompt **moved to session 2 or 3**. Dashboard "make it yours" prompt after the first completed plan session. "About you" depth (goals, majors with NCLEX paths) on day 2–3 via a single card. | 0 s on day 1 | Protect the first session. Customize after success. |

**Total day-one budget:** about 3.5–5 minutes to a recall win plus a plan. The current flow asks for school, level and major before any value, ends on "Your first review is tomorrow," and adds an extension nudge. Under the redesign, onboarding ends on a dated plan and an opt-in reminder instead.

**Day 1 to day 30 follow-through:**
- **Day 1 SMS** (if opted in): one message at the chosen time with 3 recall questions answerable by text.
- **Day 2–7:** the dashboard leads with "Next session" (Learn) instead of the guide; reading sits behind "Review notes."
- **Week 2+:** a weekly study-days goal (for example, 3 of 7), with a freeze and a repair. Escalate prompts as the exam approaches. After the exam, ask "How did it go?" and pull the Canvas grade with consent.

## 3. Metrics and A/B Test Design for a Small Startup

### 3.1 Metric hierarchy
- **North-star (slow):** weekly active studiers, meaning students who complete at least one recall session (Learn, Quiz, Flashcards, Practice, or SMS quiz) in a week.
- **Primary experiment metric (fast leading indicator):** **First-session recall activation.** The share of new signups who, within 24 hours, (a) create a guide, (b) answer at least 3 recall questions, and (c) save an exam date. It is measurable on day 1 and sits on the causal path to D7.
- **Secondary:** D1 and D7 return (any recall session on day 1 / within days 6–8), number of guides in week 1, SMS opt-in rate, Pro trial starts.
- **Guardrails:** SMS STOP/opt-out rate (pause any variant above about 5% per week), complaint and "too many messages" replies, signup completion rate (the new flow must not lose people before step 3), guide-generation error rate, and time-to-first-question. Also watch for drops in the share of confidence ratings marked "Sure" that are actually correct; a calibration regression means the gamification is pushing guessing.

### 3.2 Sample-size math (two-sided α=0.05, power 0.80, two arms)
Formula: n per arm ≈ (1.96 + 0.84)² × [p₁(1−p₁) + p₂(1−p₂)] / (p₂ − p₁)².

| Metric and baseline | Lift to detect | n per arm | Total | At ~40 signups/mo | At 500 signups/mo |
|---|---|---|---|---|---|
| Recall activation 30% → 50% | +20 pts | ~90 | ~180 | ~4.5 months | ~2 weeks |
| D7 return 25% → 40% | +15 pts | ~150 | ~300 | ~7.5 months | ~3 weeks (+7 days to observe) |
| D7 return 25% → 35% | +10 pts | ~325 | ~650 | >1 year | ~6 weeks |
| D30 return 10% → 15% | +5 pts | ~690 | ~1,380 | not feasible | ~3 months (+30 days) |

**Interpretation:** at current volume, only large effects on a fast metric are detectable. That favors bold, whole-flow redesigns over button tweaks.

### 3.3 Recommended design
1. **Randomize at signup, 50/50, stratified** by acquisition source and by whether the student connects Canvas (strata fixed before treatment). Stratification is the practical variance-reduction tool for brand-new users.
2. **CUPED caveat:** CUPED needs pre-experiment data on the same user, which brand-new signups do not have. Use it only for experiments on existing users (for example, an SMS cadence test on users with 2+ weeks of history). For onboarding tests, use regression adjustment on covariates collected *before* randomization (source, device, school level if known at signup).
3. **Bayesian analysis with a decision rule fixed in advance.** Beta-Binomial on the primary metric. Ship if P(B > A) ≥ 90% and expected loss is under 1 percentage point. Stop for futility if P(B > A) < 20% after the planned n. Do not peek repeatedly at frequentist p-values. If you do want early looks, pre-register 2–3 group-sequential checkpoints.
4. **Duration:** fix it in calendar terms (at least 2 full weeks, covering both weekend and weekday signups and avoiding a single exam week). Continue until the planned n is reached or 8 weeks pass, whichever comes first, then decide on the posterior.
5. **Long-run holdout:** keep 10–20% of new users on the old flow for one academic term to check that the leading-indicator win shows up in D30 and in grades. This is the only honest test of the "made for you" claim at Cordia's scale.
6. **Qualitative research in parallel (and instead of A/B tests when n is under about 100 a month):** 5–8 moderated sessions per iteration with real students uploading real slides, plus a one-question exit survey for non-activators ("What stopped you from trying the questions?"). The 37 accounts that never made a guide are the highest-value interview pool.

### 3.4 First three experiments, in order
1. **Onboarding v2 (section 2) vs current.** Primary: recall activation. Big swing, detectable.
2. **SMS: course-tied two-way "quiz me" vs generic reminder**, among opt-ins. Primary: D7 recall return. Guardrail: STOP rate.
3. **Default dashboard per major vs default plus first-week "make it yours" prompt.** Primary: week-2 recall sessions. Expect a small effect; run it only once volume allows, otherwise test qualitatively.

## Caveats
- Most retention benchmarks come from vendors with proprietary datasets and differing definitions. Use them for orientation, not as targets.
- Most onboarding A/B evidence (Duolingo, Adapty) is first-party or vendor-published, with unknown sample sizes and selective reporting.
- The education SMS literature studies administrative tasks (FAFSA, enrollment) and one course chatbot. Transfer to a consumer study app is plausible but unproven.
- Customization and IKEA-effect studies measure valuation and satisfaction, not retention.
- Cordia's own numbers come from about 77 accounts. Every rate has a wide confidence interval: for example, 34 of 71 is 48% with a 95% interval of roughly 36–60%.
- No study was found showing apps can learn individual-level "what works for you" from Canvas grades. Present this as exploratory.

## What Cordia Should Do
1. **Redefine activation as recall, not reading.** Instrument "answered at least 3 recall questions within 24 hours plus saved an exam date" as the company's primary early metric this week.
2. **Ship Onboarding v2 (section 2).** Move "About you" into the build wait, cut Check yourself to 3 questions with confidence tags, end on a dated plan with "why" lines, and move the Chrome extension prompt to session 2 or 3.
3. **Make Canvas connect the recommended path,** since it supplies exam dates automatically and makes the plan feel made for the student without extra questions.
4. **Replace learning-style-type questions with 2–3 behavior questions** (reread vs self-test, how early they start, typical session length) and use each answer visibly (for example, "You said you usually reread, so we start you in Learn").
5. **Make the home screen action-first:** "Next session: 10 min, Bio 201" above the guide. Put reading behind a secondary tab and track whether reading-only users convert to recall.
6. **Rebuild the SMS assistant around the Georgia State model:** opt-in, course- and date-specific, two-way ("reply 'quiz me'"), at most 3 messages a week by default, with automatic backoff after 2 ignored messages and quiet hours. Never send grades by SMS.
7. **Soften streaks:** count study-days per week, keep the weekly freeze, add a one-time repair, suppress streak pressure in the 48 hours after a missed exam-prep day, and never send "you lost your streak."
8. **Default dashboards per major; customization second.** Ship strong defaults (Nursing: NCLEX path plus Practice; STEM: Practice plus Quiz). Offer "make it yours" only after the first completed plan session, with at most 3 suggested edits.
9. **Explain every recommendation** with a one-line "because…" built from data the student knowingly provided. Keep grade-linked insights in-app, opt-in, and labeled as patterns across students until Cordia has enough data.
10. **Run experiments the small-n way:** one big test at a time, recall activation as the primary metric, Bayesian ship rule fixed in advance, 10–20% term-long holdout, and 5–8 student interviews per iteration, starting with the 37 non-activated accounts.
11. **Treat premade exam prep paths (NCLEX, MCAT, etc.) as acquisition and activation wedges:** a dated plan exists the moment a student picks the exam and date. Measure them with the same recall-activation metric.
