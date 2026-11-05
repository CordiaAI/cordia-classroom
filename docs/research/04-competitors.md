# AI Study Tools & Exam Prep, 2025–2026: Personalization, Onboarding and Study Plans — Competitive Research for Cordia Classroom

No product we reviewed links how a student studied to the grade they actually earned in their LMS; that closed loop, plus study plans built from real Canvas exam dates, is the most defensible gap open to Cordia. The best tools today either schedule individual cards well (Anki/FSRS) or diagnose and adapt toward one standardized exam (UWorld, Archer, and now Gemini study notebooks). Nobody reliably does both for an ordinary college midterm, and nobody checks the result against the grade.

## TL;DR

- **The threat is free, general-purpose AI, not Quizlet.** ChatGPT Study Mode (July 2025), Gemini Guided Learning (August 2025), Claude's learning mode (all users, August 2025), NotebookLM flashcards and quizzes (September 2025) and Gemini study notebooks (June 2026) all reach students at $0. Gemini study notebooks already run a diagnostic, build adaptive lessons and track progress. Instructure's Project Athena (announced July 2026) will use each student's Canvas course context. Cordia's differentiation has to come from Canvas grade outcomes, exam-date-driven plans, a calibration-aware spaced-repetition model, and trustworthy billing. "AI makes flashcards from your PDF" is no longer a differentiator.
- **Most "personalized study plans" are calendar math.** Exam-prep planners ask for dates and hours, not diagnostics. UWorld's planner takes a start date, end date and study hours. Kaplan's takes a test date and hours per week. Magoosh sells expert-made schedules chosen by timeline. None of the vendors' own pages we found states that the schedule is recalculated from question performance. The flashcard apps that do adapt (Anki FSRS, Brainscape, Quizlet's Learn) adapt at the card level and don't plan toward an exam date.
- **Win on the closed loop and on trust.** Build test-date-aware plans from Canvas exam dates and a short diagnostic. Re-plan daily from FSRS memory estimates. Treat Sure/Think so/Guess as calibration data, not just a scheduling input. Show students post-exam "how you studied vs. what you scored" receipts. Make cancellation as easy as signup. Students resent Quizlet's paywall and StudyFetch's billing, so those last two are real wedges, not just hygiene.

## Key Findings

1. **General-purpose AI labs have commoditized "AI tutor + flashcards from your notes."** OpenAI launched Study Mode on July 29, 2025 for Free, Plus, Pro and Team users; per Axios, students "can turn study mode on or off at any time during a conversation." Google shipped Guided Learning in Gemini on August 6, 2025, and Anthropic turned on Learning mode for all Claude users on August 14, 2025. NotebookLM added source-grounded flashcards, quizzes and a "Learning Guide" tutor style on September 8, 2025. On June 25, 2026, Google launched study notebooks in Gemini: a diagnostic quiz, short adaptive lessons that update with quiz results, a skill-based progress dashboard, and SAT prep with Princeton Review questions. *Evidence strength: strong (primary vendor announcements plus multiple outlets).*

2. **The LMS is becoming the battleground, but grade data is unused.** Instructure announced Project Athena on July 22, 2026, an AI study coach that will read course materials, assignments and upcoming assessments through a read-only Canvas connection. Instructure says it will "track confidence and identify areas where students need additional support." It is in development, with no general release date announced. Per Instructure's press release, Hinds Community College, "the largest community college in Mississippi, will provide Athena to all 7,000 of its students this fall after a successful pilot this spring." Knowt reportedly has a Chrome extension that works with Canvas, Moodle and Google Classroom, and NotebookLM reportedly connects to Classroom, Canvas, Schoology and Moodle. None of the sources we found describes any product correlating study behavior with grades actually earned. *Evidence strength: moderate (absence of evidence across many product pages, not proof of absence).*

3. **Spaced-repetition quality is uneven, and the "algorithm" is often marketing.**
   - **Anki** ships FSRS natively since 23.10 (October 2023). Sources disagree on whether FSRS is now the default for new profiles: some 2026 guides say Anki 25.07 made it default, while the Anki GitHub discussion and other guides still describe SM-2 as default. Treat this as unresolved.
   - **RemNote** offers FSRS v6 as a beta, opt-in option with Anki SM-2 as the default.
   - **Brainscape** uses Confidence-Based Repetition, a 1–5 self-rating.
   - **Quizlet** uses a proprietary system. One critic describes it as "closer to Leitner boxes"; Quizlet does not publish it.
   - FSRS's "20–30% fewer reviews" claim comes from benchmarks on hundreds of millions of Anki reviews. Even a contributor in the Anki community has questioned whether benchmark gains translate to real-world impact.
   - *Evidence strength: moderate. FSRS's benchmark superiority over SM-2 is well replicated on prediction accuracy, but learning-outcome evidence is thinner.*

4. **Exam-prep incumbents personalize with readiness scores more than with plans.** Archer Review sells unlimited readiness assessments. It says scoring "High" or "Very High" on four consecutive assessments correlates with a 98.98% chance of passing the NCLEX. That figure is vendor-reported and has not been independently validated. UWorld's planner builds a calendar from a start date, end date and study hours, and its marketing calls the plan "adaptive." Kaplan MCAT offers "placement quizzes to skip topics you already know" and a calendar driven by test date and hours per week. Magoosh offers "expert-made study plans tailored to your timeline." *Evidence strength: moderate for features (primary pages); weak for outcome claims (vendor self-reports).*

5. **Fast growth is concentrated in AI-native note-to-study apps and free big-tech tools. Homework-help incumbents are collapsing.**
   - **Gizmo:** 13M users across 120+ countries and a $22M Series A led by Shine Capital, up from about 300,000 users in 2023, per TechCrunch on April 15, 2026; Gizmo had seven employees before the raise and planned to grow to about 30.
   - **Turbo AI (formerly Turbolearn):** per TechCrunch (October 23, 2025), went from 1M to 5M users in six months with eight-figure ARR at roughly $20/month, adding "twenty thousand new users" daily after raising only $750,000. Later reporting cites 10M users and $13M lifetime revenue with a 10-person team.
   - **Quizlet:** acquired Coconote in February 2026 and discontinued its Q-Chat tutor in June 2025.
   - **Chegg:** non-subscriber traffic fell 49% year over year in January 2025. Per its SEC Form 8-K, its October 2025 restructuring was "expected to impact approximately 388 employees, or about 45% of our current workforce," after a May 2025 cut of about 248 employees (22%).
   - *Evidence strength: strong for Chegg (SEC filings); moderate for startup user counts (company-reported, repeated by press).*

6. **Student complaints cluster around paywalls and billing more than AI accuracy.**
   - **Quizlet:** has gradually capped Learn and Test on free accounts. Free caps reportedly tightened again in May 2026, and Quizlet holds a 1.4/5 Trustpilot score (secondary report).
   - **StudyFetch:** Trustpilot, App Store and BBB complaints repeatedly describe renewals after attempted cancellation, refusals to refund, and lockouts that block cancellation. StudyFetch's overall Trustpilot score is still about 4.1, so the product itself is liked.
   - **Hallucination:** a recurring critique of general chatbots in study modes. Chegg's own filing cites that 53% of undergraduates who use generative AI worry about "receiving incorrect or inaccurate information."
   - *Evidence strength: moderate (review sites and press; self-selected samples).*

7. **Learning-styles onboarding is not supported by evidence.** The most sympathetic recent meta-analysis (Clinton-Lisell & Litzinger, 2024; 21 studies, 1,712 participants) found a small effect. But only 26% of outcome measures showed the crossover interaction the matching hypothesis requires, and the authors judged the benefit too small and too infrequent to act on. A 2025 review of 17 meta-analyses reports d = 0.04 for studies that actually test matching. *Evidence strength: strong (multiple meta-analyses).*

## Comparison Table

"Not verified" means we could not confirm the item from 2025–2026 sources in this research.

| Product | Onboarding / personalization | Study-plan inputs | Adaptivity | Test date | Diagnostic | SRS algorithm | LMS / grade data | Confidence ratings | Pricing (2025–26) | Top student complaints |
|---|---|---|---|---|---|---|---|---|---|---|
| **Quizlet** | Course-Powered Quizlet (2025) organizes by school/course; Memory Score estimates recall | Sets / uploaded notes | Learn mode adapts within a set; no exam plan | Not verified | No | Proprietary, unpublished | Classroom/teacher features; no student grade linkage found | No | Free (capped); Plus $7.99/mo or $35.99/yr; Plus Unlimited $9.99/mo or $44.99/yr | Learn/Test paywall and caps; Q-Chat removed (June 2025) |
| **Anki** | None (manual decks) | Decks, user settings | Card-level (FSRS optimizes per user) | No (add-ons only) | No | FSRS built in since 23.10; SM-2 legacy (default status disputed) | None | Again/Hard/Good/Easy (recall grade, not confidence) | Free; iOS $24.99 one-time | Steep setup; no AI generation natively |
| **Knowt** | Not verified | Notes, PDFs, videos | Learn mode; reports dispute whether it uses a true SRS algorithm | Not verified | No | Not published | Chrome extension reportedly works with Canvas/Moodle/Google Classroom; no grade linkage found | No | Free core; Ultra $24.99/mo or $149.99/yr (earlier listings $119.99/yr) | AI features moving to Ultra; ads on free |
| **StudyFetch** | Not verified | Slides, PDFs, lecture recordings | AI tutor "Sparky"; no verified adaptive planner | Not verified | Not verified | Not verified | Listed among Canvas-connected tools; no grade linkage found | No | Free (small); paid ~$19.99/mo, ~$96/yr | Renewals after cancellation, no refunds, lockouts, bugs |
| **Brainscape** | Expert "certified" decks (MCAT, bar, NCLEX) | Decks | Card-level via confidence | No | No | Confidence-Based Repetition (1–5) | Teacher class tracking; no LMS grades | **Yes, core mechanic** (scheduling, not calibration) | Free; Pro $19.99/mo, $59.94/semester, $95.88/yr, $199.99 lifetime | Images/reverse cards behind Pro; AI is thin |
| **RemNote** | None | Notes → flashcards | Card-level | No | No | SM-2 default; FSRS v6 beta (opt-in) | None | No | Pro $10/mo or $96/yr; Pro+AI $20/mo; Life-Long Learner $395; 25% education discount | Complexity (not verified via review sites) |
| **Notion-based tools** | Templates only | Manual | Not verified | Manual | No | None native | Not verified | No | Not verified | Not researched in depth |
| **Khanmigo / Khan Academy** | Mastery-based courses; district MAP Growth integration | Khan course content | Mastery progression | Not verified | Course challenges (Khan) | Not applicable | District rostering (Clever/ClassLink); no student-grade linkage found | No | Khanmigo $4/mo or $44/yr; free for teachers; districts ~$10–15/student/yr | Not free for students; K-12-centric |
| **UWorld (NCLEX)** | Exam choice | Start date, end date, study hours per day | Marketed as "adaptive"; recalculation from performance not stated | Yes (end date) | Self-assessments (1–6 by plan) | None (QBank) | None | No | NCLEX-RN $139/30 days to $449/730 days | Price; access clock can't be paused |
| **Kaplan (MCAT)** | Placement quizzes | Test date, hours per week | "Flexible" plan; "homework based on your areas of improvement" (primary); recalculation claimed only by third-party reviews | Yes | Placement quizzes | None | None | No | MCAT On Demand from $1,599; Live Online from $2,399 | Not verified this cycle |
| **Archer Review** | Exam choice | Recommended protocol (85 questions/day; readiness test every 5 days) | Readiness-driven, not a recalculated calendar | Implicit | Baseline assessment; unlimited readiness tests | None | None | No | RN Q-Bank + CAT $79/1 mo, $129/3 mo; Sure PASS from $159 | Pass-probability claims are vendor-reported |
| **Magoosh** | Choose schedule by timeline | Timeline (1 week to 6 months) | Static schedules plus a predicted-score tool | Yes (picks schedule length) | Not verified | None | None | No | GRE from $149; score guarantee | Not verified this cycle |
| **ChatGPT Study Mode** | None (chat) | Whatever the student pastes | Socratic dialogue, built on system instructions | No | Ad hoc | None | None (some Canvas tools route to it) | No | Free on all plans | Optional, easy to bypass; hallucination risk |
| **Claude learning mode** | None | Chat / uploads | Socratic style | No | Ad hoc | None | None | No | All Claude.ai users (Aug 2025) | Same as above |
| **NotebookLM** | None | Uploaded sources | Quizzes/flashcards with difficulty settings; April 2026 upgrade surfaces weak topics (third-party report) | No | No | None (saves progress on flashcards) | Classroom/Canvas/Schoology/Moodle connections reported | No | Free; paid tiers via Google AI plans | Usage limits on free |
| **Gemini study notebooks** | Study goal or uploaded materials | Goal, class materials, test-prep target | **Yes: lessons update from follow-up quizzes** | Not verified | **Yes, diagnostic quiz** | None | Google Classroom assignment and teacher insights (rolling out) | No | Free in Gemini app (18+ personal accounts first) | Too new for review data |
| **Gizmo** | Not verified | Notes/documents | Gamified, social review; streaks | Not verified | No | Not verified | None found | No | Not verified | Not verified |
| **Turbo AI** | Not verified | Lecture recordings, PDFs, YouTube | Flashcards with spaced repetition (claimed) | No | No | Not published | None found | No | ~$20/mo (founders testing pricing) | Not verified |
| **Project Athena (Instructure)** | Via Canvas account | Canvas materials, assignments, upcoming assessments | "Continuously adapting difficulty" (announced) | Has access to upcoming assessments | Not specified | Not specified | **Read-only Canvas**; grade-outcome learning not described | **"Track confidence"** (announced) | Institution-sold; in development | Not yet released |
| **Chegg / Course Hero** | Not applicable | Homework Q&A | No | No | No | Not applicable | No | No | Not verified | Traffic collapse; restructuring |

Not covered with verified 2025–2026 data: Mindgrasp, Revisely, Quizgecko, Studocu AI, Speechify, Wizeprep and Pencil. We found no credible growth evidence for them comparable to Gizmo's or Turbo AI's. Brainly reported 15M daily active users in 2024 and repositioned as an "AI Learning Companion" in 2025.

## Details

### Onboarding and personalization: what products actually ask

- **Profiles are thin.** Consumer flashcard apps (Anki, RemNote, Brainscape) ask almost nothing at signup. Quizlet's 2025 Course-Powered Quizlet personalizes by institution and course.
- **The richest diagnostic is free.** Gemini study notebooks take a goal or materials, give a diagnostic quiz, and break goals into "over 100 objectives categorized as strengths, focus areas, or untouched topics."
- **Exam-prep onboarding is exam choice plus a calendar.** UWorld takes start date, end date and hours per day; Kaplan takes test date and hours per week; Magoosh takes your timeline. Kaplan and Archer add placement or baseline assessments.
- **Nobody we found asks evidence-based questions about how a student studies** (for example, rereading vs. self-testing, or planning behavior), and nobody uses year or major to set defaults. This is open space. Cordia should use these answers only as priors that behavior data overrides.

### Study plans: static vs. recalculated

The market splits into three groups:

- **Card-level adapters with no exam plan.** Anki FSRS, RemNote, Brainscape and Quizlet Learn optimize when you see a card, not what to do before Thursday's midterm.
- **Calendar planners for standardized exams.** UWorld, Kaplan and Magoosh distribute content across dates and hours. UWorld markets its planner as "adaptive" and contrasts it with competitors' "static calendars," but its own feature page describes only date and hour inputs. We found no primary statement that it re-plans from performance. Calling these "AI personalization" overstates what is verifiable.
- **Diagnostic-then-adapt tutors.** Gemini study notebooks and the announced Project Athena. This is the closest analog to Cordia's plan concept. Neither has published how it handles a fixed exam date or long-term retention scheduling.

### LMS and grade data

Canvas integrations are common, but they are read-only and used for context: deadlines, materials and assignments. Examples are DormWay, UniFlow, AskSia, StudyFetch, Knowt's extension, NotebookLM and Athena. Grade passback exists only on the instructor side (EssayGrader, TimelyGrader). We found no product that tells a student "spacing your review over 6 days before Exam 2 coincided with +11 points versus Exam 1." Athena is the most credible future threat because Instructure owns the data. But it is being co-designed with institutions, is sold through them, and has no release date.

### Confidence-based learning and calibration

Brainscape is the only mainstream app built around confidence, and it uses the 1–5 rating to schedule, not to measure calibration. Athena says it will "track confidence." No product we found reports calibration back to the student, for example: "when you say Sure you're right 71% of the time." Cordia already collects Sure/Think so/Guess, so it can compute this with no new UI.

### Pricing context for Cordia

| | Cordia Pro | Quizlet Plus | Brainscape Pro | Knowt Ultra | StudyFetch | RemNote Pro |
|---|---|---|---|---|---|---|
| Monthly | $9.99 | $7.99 | $19.99 | $24.99 | ~$19.99 | $10 |
| Longer term | $29/semester | $35.99/yr | $59.94/semester | $149.99/yr | ~$96/yr | $96/yr |

Cordia's $29 semester plan undercuts Brainscape's semester plan by half and Knowt's annual plan on a per-term basis. Quizlet's annual plan is cheaper per month (about $18 per semester-equivalent), so Cordia must justify the premium with plans and outcomes, not flashcards. The real price competitor is $0 ChatGPT, Claude and Gemini.

### Popular beliefs the evidence doesn't support

- **"Match instruction to learning style."** Meta-analytic support is negligible (d = 0.04 for matching tests). Even the friendliest analysis advises against adopting it. Do not ask about VARK.
- **"AI-personalized study plan."** At UWorld and Magoosh this is primarily a date-and-hours calendar or a schedule chosen from a menu, per their own pages.
- **"98.98% pass if you hit our readiness bar."** This is Archer's own correlation among self-selected users. It is not independently validated and not causal.
- **"FSRS = 20–30% fewer reviews, therefore better grades."** The benchmark measures prediction of recall on Anki data, not exam outcomes. It is a reasonable default, not a proven grade lever.
- **"Study modes in chatbots fix cheating."** Study Mode is optional and has no lock-in controls. OpenAI VP of Education Leah Belsky said at launch that "it will take committed students to make Study Mode work as intended."

## Gaps Cordia Can Own (ranked)

| Rank | Gap | Evidence it's a gap | How hard for incumbents to close |
|---|---|---|---|
| 1 | **Study-behavior → actual-grade feedback loop** | No product found links study logs to LMS grades. Integrations are read-only and context-only. | **Hard.** Quizlet, Anki, Gemini and ChatGPT lack per-student grade access. Instructure could, but sells through institutions and moves through a venture studio; Athena is unreleased. A cross-semester outcome dataset compounds. |
| 2 | **Exam-date-aware, re-planned study plans for ordinary course exams** | Standardized-exam planners use dates and hours; flashcard apps have no exam plan. Gemini diagnoses but doesn't auto-ingest course exam dates. | **Medium.** Gemini could add Classroom dates; Athena has upcoming assessments. Cordia's edge is combining Canvas dates with an FSRS retention target on exam day. |
| 3 | **Confidence calibration as a learning outcome** | Brainscape uses confidence only for scheduling; Athena only "tracks" it. | **Medium-easy to copy, but few will.** It requires every-answer confidence capture, which slows UX for mass-market apps. |
| 4 | **Course-to-licensure bridge for nursing** | Archer and UWorld start at graduation and are sold on 30–730-day clocks. No one connects semester coursework to NCLEX readiness. | **Medium.** QBank incumbents have content depth but no course data. Cordia should not try to out-QBank them early. |
| 5 | **Trustworthy billing as a brand** | StudyFetch renewal and cancellation complaints; Quizlet paywall resentment and 1.4/5 Trustpilot. | **Easy to copy, rarely copied.** Incumbents' revenue depends on auto-renewal friction. |
| 6 | **Evidence-based onboarding (study habits, not learning styles)** | No product asks validated strategy questions. | **Easy technically.** The moat is linking answers to outcomes (gap 1). |

## What Cordia Should Do

### 1. Onboarding (major, year, goals, indirect study questions)

- **Ask (90 seconds max):** major, year, the courses pulled from Canvas, a target grade per course, and the next exam per course (pre-filled from Canvas so the student only confirms).
- **Ask four indirect behavior questions.**
  - "The night before an exam, you mostly…": reread/highlight, make or redo practice questions, rewrite notes, or watch videos. This measures retrieval-practice use.
  - "Last exam, when did you start studying?" This measures spacing and procrastination.
  - "How sure are you usually about how you'll do?" This is a self-efficacy and calibration prior.
  - "How many hours can you realistically give on weekdays and weekends?"
- **Run a 5-item calibration warm-up from their own uploaded material** with Sure/Think so/Guess. This seeds both FSRS difficulty and a calibration baseline.
- **Do not ask learning style.** Say so in the UI ("we don't ask your learning style — research doesn't support it; we watch what works for you"). It builds trust and differentiates.
- **Store answers as priors with decay.** After about 2 weeks of behavior, observed data replaces stated habits. Show students their "stated vs. actual" pattern, e.g. "You said you test yourself; 80% of your time is Flashcards flip-mode."

### 2. Recommended dashboard per major (fully editable)

- **Ship 4–5 templates, not one per major.**
  - Nursing: NCLEX practice, readiness trend, and a pharm/dosage Practice widget.
  - STEM problem-solving: Practice (AI-graded problems) first, plus a formula Learn ladder.
  - Memorization-heavy (bio, anatomy, languages): Learn ladder plus due-today Flashcards.
  - Reading/essay (humanities, social science): Quiz on concepts plus an argument-recall Learn ladder.
  - Undeclared/default: "Next exam" card plus a due-today queue.
- **Make the first widget always "Your next exam: X days, plan for today."** The plan, not the content library, is the product.
- **Track widget engagement.** After 3 weeks, suggest one change ("You never open Match; swap for Quiz?"). Always offer "reset to recommended."

### 3. Study plans for any test

- **Inputs:** the Canvas exam date (auto); the Canvas modules or files mapped to that exam (auto-suggested, student confirms); a 10–15 item recall-format diagnostic across topics with confidence; available hours; and the current FSRS memory state for every card and idea.
- **Engine:** move to FSRS now, with a single memory model shared across Learn, Flashcards and Quiz.
  - Set the objective as **predicted retrievability on exam day**, not generic 90% retention.
  - Re-plan **daily**: allocate minutes to topics with the largest gap between predicted exam-day recall and the target-grade threshold.
  - Front-load first exposures, so no idea's first recall attempt happens inside the last 48 hours.
  - Map confidence into review grades: wrong → Again; correct + Guess → Hard; correct + Think so → Good; correct + Sure → Good/Easy. Track *wrong + Sure* separately as "confident errors" and resurface them in a different format (this matches Cordia's Quiz rule).
- **Show it honestly:** a "projected readiness" band with uncertainty, and a change log ("Plan updated: you missed 3 enzyme items; +15 min tomorrow"). This is how Cordia proves it isn't a static calendar.
- **SMS:** a morning text with today's 20–40 minute plan. Students can reply "busy" to push the plan and trigger a re-plan, or "done" to log. Send the re-plan summary 72 hours before the exam.

### 4. Feedback loop: study behavior → Canvas grade

- **Log per exam:** days studied, number of distinct sessions (spacing), share of time in recall vs. recognition modes, first-try Quiz accuracy, calibration error, share of total study time in the final 24 hours (cramming), and plan adherence. Join these to the matched Canvas assignment grade with explicit student consent.
- **Phase 1 (this term):** a post-exam "Study receipt" comparing what you did, what you scored, and your last exam. Keep it descriptive only, with no causal claims.
- **Phase 2 (after ≥3 exams per student):** per-student models that compare the student with themselves. Cohort priors come from students in the same course or major, with minimum group sizes for privacy.
- **Phase 3 (the moat):** opt-in randomized micro-experiments. For example, alternate exam-day retention targets or interleaving across a student's courses. These yield causal evidence about "what works for you" that no competitor has.
- **Guardrails:** grades are sensitive. Use student-authorized Canvas OAuth only, explain clearly what is read, never share grades with anyone, and allow one-tap deletion. Expect institutional questions as Athena raises their standards.

### 5. Premade, expert-verified exam paths

- **Start where Cordia already has a wedge: NCLEX.** Build a "course → NCLEX" path that turns each nursing course's Canvas material into NCLEX-category mastery. It should be active from the first semester, not only after graduation.
- **Make verification visible.** Show a named reviewer with credentials per item bank, version dates, and an in-app error-report button with a published fix turnaround. "Expert-verified" is otherwise an empty claim, the same weakness as Brainscape's "certified" decks.
- **Don't publish pass-probability numbers until you can validate them.** Collect self-reported NCLEX results and calibrate readiness against them. This contrasts with vendor-reported figures like Archer's.
- **Sequence other exams by fit with Cordia's college audience:** MCAT, then CPA, then LSAT and the bar. Defer ACT/SAT: Gemini study notebooks already offer free SAT diagnostics with Princeton Review content.
- **Partner or license content** (faculty item writers, open textbooks) rather than racing UWorld and Archer on QBank size.

### Pricing and trust moves

- Keep the no-card 7-day trial. Text a reminder 48 hours before any paid renewal.
- Offer one-tap cancel in the app and by SMS ("reply CANCEL").
- Make the $29 semester plan non-renewing by default, with a renewal prompt at term end.
- Market these explicitly against the billing complaints dominating StudyFetch and Quizlet reviews.

## Caveats

- **Many pricing figures come from third-party pages checked in 2025–2026,** and they conflict, notably for Knowt ($119.99 vs. $149.99/yr) and Brainscape. Verify on vendor pages before publishing comparisons.
- **Anki's default-scheduler status is disputed across sources.** Some secondary sites date Gizmo's funding to April 2025, but TechCrunch's report is dated April 15, 2026.
- **"Not verified" cells reflect limited research budget,** not confirmed absence of a feature. This applies especially to Mindgrasp, Revisely, Quizgecko, Studocu, Speechify, Wizeprep, Pencil and Notion-based tools.
- **Readiness and pass-rate statistics are vendor self-reports.** Startup user counts are company-reported.
- **Learning-science claims about retrieval practice and spacing** rest largely on older foundational research that was not re-reviewed here. The learning-styles conclusion rests on 2024–2025 meta-analyses.
