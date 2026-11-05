# Cordia Classroom: How Students in Nine Major Archetypes Study and Are Assessed, and What Cordia Should Default To

The most important finding: personalization should change **what students practice and when**, based on how each major is assessed. It should not change how content is "styled" for the learner. The strongest evidence in learning science, spaced practice and retrieval/practice testing, applies across all nine archetypes. "Learning styles" matching does not hold up. So per-major defaults should vary the **format of retrieval** (recall for memorization-heavy majors, worked problems for quantitative majors, code for programming, written argument for humanities, performance and critique for studio majors). They should not vary the *principle*.

## TL;DR

- **Spacing and retrieval practice are the backbone for every major (strong evidence).** Two caveats matter for building it. A 2025 meta-analysis found spacing reliably helps math learning (g = 0.28), but retrieval practice alone did not show a robust effect in math. Interleaving helps when the student has to tell similar problem types apart, and *hurts* for simple word lists. Learning styles, highlighting and rereading are not supported.
- **The struggle points are predictable and Canvas-visible.** They are gateway courses in year 1–2: average DFWI rates are about 34% in intro calculus, 30% in intro accounting and 29% in intro chemistry across a multi-institution study, and a 2025 CS1 cohort had a 46% failure rate. Then come licensure and entrance exams late in the degree: NCLEX (first-time U.S. RN pass rate fell to 86.7% in 2025), MCAT (typically spring of junior year), FE (senior year), CPA (2025 core-section pass rates of 42–63%), the NextGen bar (launched July 2026), and Praxis/edTPA (whose requirements are shrinking state by state).
- **Cordia's AI must be built as a tutor with guardrails, not an answer engine.** In Bastani et al.'s 2025 PNAS field experiment in high school math, unrestricted GPT‑4 ("GPT Base") improved practice scores but cut exam grades by 17%, and a hint-based "GPT Tutor" "largely mitigated" that harm. Students already use AI almost universally (95% of UK undergrads in HEPI's 2026 survey). That makes a "Retain/Practice-first" default, and linking study behavior to Canvas grades, Cordia's clearest edge.

---

## Key Findings Across All Archetypes (with evidence ratings)

| Finding | Evidence | Notes |
|---|---|---|
| Practice testing and distributed (spaced) practice are the highest-utility study techniques | **Strong** (foundational 2013 review, still the main reference; replicated) | Dunlosky et al. (2013) rated only these two of ten techniques "high utility." A 2025 college study found retrieval practice improved final exam performance in a diverse sample. |
| Spacing helps math learning; retrieval practice alone in math is less proven | **Moderate–strong** for spacing, **weak/contested** for math retrieval | 2025 meta-analysis: spaced vs. massed g = 0.28 (27 studies); "the current literature does not provide conclusive evidence for a consistent effect of retrieval practice for mathematics learning." |
| Free recall beats cued recall; retrieval beats elaboration only slightly | **Moderate** (2025 meta-analysis) | Retrieval vs. elaborative tasks g = 0.14; free vs. cued recall g = 0.23. The advantage held only against concept mapping and group discussion. This supports Cordia's "only recall masters an idea" rule. |
| Interleaving helps discrimination between similar categories | **Moderate** (foundational 2019 meta-analysis) | Overall g = 0.42, paintings g = 0.67, math g = 0.34, and words *negative* (about −0.39). Use it for problem types and diagnoses, not vocabulary lists. |
| Elaborative interrogation and self-explanation | **Moderate** | Rated moderate utility by Dunlosky. Self-explanation meta-analysis g ≈ .55 (2018). Benefits are larger when elaborations are precise and self-generated. |
| Writing about content improves content learning | **Moderate** (K‑12 meta-analysis, 2020) | Graham, Kiuhara & MacKay: g ≈ 0.30 across 56 experiments in science, social studies and math. No equivalent university-humanities meta-analysis was found. |
| Retrieval practice may buffer stress | **Weak–moderate** | In a 2025 meta-analysis summary, 54% of students in one intervention reported reduced test anxiety. This is self-report. |
| Unguarded generative AI can harm learning; guardrails mitigate it | **Moderate** (one large field RCT, high school math) | GPT Base: +48% on practice, −17% on exams. GPT Tutor (hint-based): +127% on practice, harm "largely mitigated." |
| **Myth: matching instruction to learning styles** | **Strong evidence against** | Hattie & O'Leary's 2025 *Educational Psychology Review* review reaffirms that the matching hypothesis fails. Yale's Poorvu Center: "no evidence." |
| **Myth: highlighting/rereading/summarizing are effective** | **Strong evidence against (as primary strategies)** | Rated low utility. "Practice testing instead of rereading." |
| **Myth: more AI help = more learning** | **Moderate evidence against** | See Bastani et al. (2025) and CS1 studies on overreliance by lower performers. |

A note on confidence ratings: Cordia's Sure / Think so / Guess ratings are well motivated. They expose calibration, meaning the gap between feeling you know something and actually knowing it, which is the core problem with rereading. The specific claim that confidently wrong answers are corrected more readily after feedback (the "hypercorrection effect") is an older foundational finding that I did not re-verify in this research pass. Treat it as plausible but unconfirmed here.

---

## 1. Memorization-heavy science and health

**Majors:** nursing, pre-med, biology, kinesiology, pharmacy, allied health

**Narrative summary.** These students face high volumes of terminology, mechanisms, drug classes and pathways. They are tested mostly with multiple-choice and application items, plus labs, practicals, clinicals and (for nursing) care plans. Nursing has the most consequential late exam. The Next Generation NCLEX launched April 1, 2023. The first-time U.S.-educated RN pass rate dropped from 91.2% (2024) to 86.7% (2025), and repeat U.S.-educated candidates passed at only 52.7%. So being ready the first time matters enormously. NGN emphasizes clinical judgment, which means application-level case questions, not recall alone. Pre-meds typically take the MCAT in spring of junior year (or the summer before) to apply without a gap year. In an AAMC survey, students reported preparing an average of 20 hours a week for three months, about 240 hours. The often-quoted ~300-hour figure is a prep-company benchmark. Scores release 30–35 days after the test. The PCAT is gone: it was retired January 10, 2024, so pharmacy applicants no longer prepare for it. Gateway pain points are general chemistry and organic chemistry. A multi-institution Gardner Institute study found an average DFWI rate of 29.4% in intro chemistry. At one institution, organic chemistry I DFW rates have trended upward even as general chemistry improved.

**What works.** Spaced retrieval is the dominant evidence-backed method, and these students already use it. In a 560-student national survey, 68.3% of U.S. medical students used Anki, averaging 17.8 hours a week (Halperin et al., 2024, as reported secondhand). A 2026 systematic review found 11 studies linking Anki use to performance. The evidence is **correlational**: daily users at one school had median Step 1 scores of 238 vs. 233.5, with no difference on Step 2. The national survey found no correlation between third-party resource use and Step 1. A 2025 state-of-the-art review of retrieval practice in the health professions supports pre-lecture quizzes and question banks. Interleaving is a good fit for distinguishing similar diagnoses, drugs and pathways (discrimination tasks), but not for raw vocabulary.

**Pain points.** Volume overload. Cramming before high-stakes unit exams. "Recognition" studying (rereading slides, recognizing MCQ answers) that fails on application items. Orgo. Clinical schedules that crowd out study time. NCLEX "select all that apply" and NGN case items. Tool complaints are not well documented in peer-reviewed sources. From common practice (not verified here): Anki has a steep setup curve and review backlogs, Quizlet content quality varies, and question banks (UWorld, Archer, ATI/HESI) are costly.

**Student vocabulary** (common usage; not verified via sources in this pass): care plans, clinicals, sim lab, SATA, NGN, "priority" questions, med math/dosage calc, ATI/HESI, practicals, bell-ringer, high-yield, Q-banks, dedicated, "AnKing deck," reviews/backlog.

```json
{
  "archetype": "Memorization-heavy science and health",
  "majors": ["Nursing (BSN/ADN)", "Pre-med / biology", "Kinesiology / exercise science", "Pharmacy / pre-pharmacy", "Allied health (PA, RT, rad tech, dental hygiene)", "Biochemistry (life-science track)"],
  "assessment_types": ["Multiple-choice and select-all-that-apply unit exams", "NGN-style clinical judgment case items (nursing)", "Lab practicals and anatomy practicals", "Clinical rotations and skills check-offs", "Care plans and concept maps", "Dosage calculation exams", "Cumulative finals", "Standardized proctored exams (e.g., ATI/HESI in nursing programs)"],
  "best_study_methods": [
    {"method": "Spaced retrieval practice (flashcards with recall, not recognition)", "evidence": "strong"},
    {"method": "Practice testing with question banks and feedback", "evidence": "strong"},
    {"method": "Interleaving similar diagnoses/drugs/pathways for discrimination", "evidence": "moderate"},
    {"method": "Elaborative interrogation (why/how does this mechanism cause this sign)", "evidence": "moderate"},
    {"method": "Daily spaced-repetition app use (e.g., Anki) associated with higher board scores", "evidence": "weak"}
  ],
  "default_study_modes": ["Learn", "Flashcards", "Quiz", "NCLEX", "Study now"],
  "learn_formats": ["Type it", "Flashcards", "Choice"],
  "tutor_default_mode": "Retain",
  "dashboard_pinned": ["Study now", "Exam countdown", "Class updates", "Streaks/Progress strip", "Calendar/study blocks"],
  "dashboard_tucked": ["Lectures", "Class sets", "Grades", "Plan my week", "Course work", "Continue"],
  "suggested_connectors": ["Canvas", "Canvas calendar feed", "Google Calendar", "Apple Calendar", "Google Drive"],
  "major_exams": [
    {"name": "NCLEX-RN / NCLEX-PN", "typical_timing": "Shortly after graduation from the nursing program; first-time U.S.-educated RN pass rate 86.7% in 2025"},
    {"name": "MCAT", "typical_timing": "Spring of junior year or summer before junior year (no gap year); later with gap years; AAMC survey average ~20 h/week for 3 months (~240 hours)"},
    {"name": "DAT / OAT / PA-CAT / GRE (for some allied health and PA programs)", "typical_timing": "Junior-senior year before applying (timing not verified in this research pass)"},
    {"name": "PCAT", "typical_timing": "Retired January 10, 2024 - no longer offered"}
  ],
  "pain_points": ["Volume of memorization and cramming before unit exams", "Recognition-based studying that fails on application/clinical judgment items", "General and organic chemistry gateway courses (avg intro chem DFWI ~29%)", "Clinical schedules crowding out study time", "High stakes of failing NCLEX the first time (repeat pass rate ~53%)", "Cost and fragmentation of Q-banks and decks"],
  "student_vocabulary": ["care plans", "clinicals", "sim lab", "SATA", "NGN", "priority questions", "dosage calc / med math", "ATI / HESI", "practicals", "high-yield", "Q-bank", "dedicated", "reviews / backlog"],
  "sources": [
    "https://kaptest.com/study/nclex/nclex-pass-rates-what-you-need-to-know/",
    "https://nclexkey.com/resources/nclex-pass-rates/",
    "https://en.wikipedia.org/wiki/National_Council_Licensure_Examination",
    "https://medschoolinsiders.com/pre-med/when-to-take-the-mcat/",
    "https://www.shemmassianconsulting.com/blog/when-to-take-the-mcat",
    "https://students-residents.aamc.org/mcat-scores/mcat-scores",
    "https://www.pharmcas.org/application-instructions/standardized-tests",
    "https://www.aacp.org/resource/pharmacy-college-admission-test",
    "https://cen.acs.org/education/undergraduate-education/Weeding-inequity-undergraduate-chemistry-classes/98/i34",
    "https://pubs.acs.org/doi/10.1021/acs.jchemed.2c01121",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC13197492/",
    "https://journals.sagepub.com/doi/full/10.1177/23821205231173289",
    "https://studycardsai.com/blog/medical-student-anki-statistics",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC12292765/",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf"
  ]
}
```

**Proposed additions (not current Cordia features):**
- NGN item-type builders (bow-tie, matrix/grid, extended drag-and-drop, case-study "unfolding" sets), if the NCLEX mode doesn't already generate them.
- Dosage-calculation drill with numeric tolerance grading.
- An MCAT exam-prep path with CARS passage practice.
- Anki/Quizlet deck import.
- A "clinical week" schedule awareness setting, so study blocks avoid clinical shifts.

---

## 2. Quantitative problem-solving

**Majors:** math, physics, engineering, chemistry, statistics, quantitative economics

**Narrative summary.** Assessment centers on timed problem-solving exams, weekly problem sets, labs with lab reports and (in engineering) design projects. Calculus is the classic weed-out course. The Gardner Institute's multi-institution study found an average 34.33% DFWI rate for introductory calculus. At Montana State, Calculus I ran 47% DFW and Calculus II 43%. Among calculus students dismissed after their first year, 95% were in the DFWI group. Engineering seniors take the FE exam in their final year or shortly after graduating. In NCEES fiscal year 2025 data (tabulated by FE-prep sites from NCEES Squared 2025), first-time pass rates ranged from 61% (Civil, Other Disciplines) to 69% (Mechanical), and repeat takers passed at only 25–37%. Purdue notes the pass rate for those who wait falls about 10% per year after graduation.

**What works, and the important nuance.** For math, the 2025 meta-analysis by Murray, Horner & Göbel is the most relevant recent evidence. **Spaced practice robustly helps (g = 0.28)**, but **retrieval practice alone (vs. restudy) was not statistically robust** in math. For Cordia, this means the "Learn" mastery ladder (built for concept recall) should not be the main engine for quantitative majors. **Practice with varied, spaced, interleaved problems** should be. Interleaving math problem types shows a small positive effect (g = 0.34) by helping students choose the right method. In a randomized trial across 54 seventh-grade math classes (Rohrer et al., 2020, *Journal of Educational Psychology*), the interleaved group outscored the blocked group 61% to 38% on an unannounced test one month later (d = 0.83). That sample was middle school, not college. Self-explanation of worked steps is supported for postsecondary math and statistics in a 2025 scoping review. AI hints must not hand over answers. The Bastani PNAS study was in math and showed −17% exam performance with an unguarded GPT‑4.

**Pain points.** Students "understand the lecture but can't start the problem." Blocked homework hides the "which method?" problem. Cramming before midterms. Copying p-set solutions (Chegg, AI). Time pressure on exams.

**Student vocabulary** (common usage; not verified): p-sets, office hours, recitation, "the curve," weed-out, plug-and-chug, derivations, lab report, FBD (free-body diagram), "show your work," cheat sheet/formula sheet, EIT.

```json
{
  "archetype": "Quantitative problem-solving",
  "majors": ["Mathematics", "Physics", "Engineering (all disciplines)", "Chemistry", "Statistics", "Economics (quantitative)"],
  "assessment_types": ["Timed problem-solving exams (often with formula sheet)", "Weekly problem sets", "Lab reports and lab practicals", "Derivations and proofs", "Engineering design projects and team reports", "Online homework systems with numeric answers", "Cumulative finals"],
  "best_study_methods": [
    {"method": "Spaced practice of problems across weeks (not massed)", "evidence": "strong"},
    {"method": "Interleaving different problem types so students practice choosing the method", "evidence": "moderate"},
    {"method": "Self-explanation of worked examples and solution steps", "evidence": "moderate"},
    {"method": "Practice testing under timed conditions with feedback", "evidence": "moderate"},
    {"method": "Retrieval practice of math facts/procedures vs. restudy", "evidence": "weak"}
  ],
  "default_study_modes": ["Practice", "Quiz", "Study now", "Outline"],
  "learn_formats": ["Written", "Type it", "Choice"],
  "tutor_default_mode": "Practice",
  "dashboard_pinned": ["Course work", "Exam countdown", "Study now", "Calendar/study blocks", "Class updates"],
  "dashboard_tucked": ["Lectures", "Class sets", "Streaks/Progress strip", "Grades", "Plan my week", "Continue"],
  "suggested_connectors": ["Canvas", "Canvas calendar feed", "Google Calendar", "Google Drive", "Notion"],
  "major_exams": [
    {"name": "FE (Fundamentals of Engineering)", "typical_timing": "Senior year (within ~32 credits of graduation) or shortly after graduating"},
    {"name": "PE (Principles and Practice of Engineering)", "typical_timing": "After ~4 years of engineering experience post-degree"},
    {"name": "GRE", "typical_timing": "Junior-senior year for graduate programs (~1h58m since Sept 2023)"},
    {"name": "ACT / SAT (high school)", "typical_timing": "Junior-senior year of high school; Enhanced ACT has optional Science since 2025"}
  ],
  "pain_points": ["Calculus as gateway (avg intro calc DFWI ~34%; up to 47% at some institutions)", "Can follow lecture but cannot start problems", "Blocked homework hides method-selection weakness", "Overreliance on solution sites and AI for p-sets", "Exam time pressure", "Delaying the FE after graduation lowers pass odds"],
  "student_vocabulary": ["p-sets", "office hours", "recitation", "the curve", "weed-out", "plug-and-chug", "derivation", "lab report", "FBD", "formula sheet / cheat sheet", "EIT"],
  "sources": [
    "https://link.springer.com/article/10.1007/s10648-025-10035-1",
    "https://tipsforteachers.co.uk/research-a-meta-analytic-review-of-the-effectiveness-of-spacing-and-retrieval-practice-for-mathematics-learning/",
    "https://arxiv.org/pdf/2503.19237",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf",
    "https://scholarsail.com/blog/what-is-interleaving",
    "https://umaine.edu/provost/wp-content/uploads/sites/14/2018/11/Gardner-Institute-Digging-into-the-Disciplines-The-Impact-of-Gateway-Courses-in-Accounting-Calculus-and-Chemistry-on-Student-Success-.pdf",
    "https://www.montana.edu/rmaher/barrier_courses/",
    "https://www.everylearnereverywhere.org/blog/what-are-gateway-courses-and-why-do-they-matter-to-equity-in-higher-ed/",
    "https://ncees.org/exams/fe-exam/",
    "https://opp.purdue.edu/Engr/Academics/FE_FS_Exams",
    "https://ppi2pass.com/resources/fe-exam/pass-rates",
    "https://www.pnas.org/doi/pdf/10.1073/pnas.2422633122"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A worked-example → faded-example → independent-problem sequence.
- Step-level grading of handwritten work from a photo upload.
- An "interleaved mixed review" problem generator across chapters.
- A formula-sheet builder.
- An FE exam-prep path (discipline-specific, keyed to the NCEES reference handbook).
- A "which method?" classification drill (identify the approach without solving).

---

## 3. Programming

**Majors:** computer science, software engineering, data science, IT

**Narrative summary.** Assessment combines weekly programming assignments (often autograded), written and on-paper coding exams, projects, and increasingly **oral code-review interviews** as an AI-era integrity measure. CS1 is a notorious gateway. A 2025 Chilean cohort of 994 students had a 46% failure rate, and failure rates in some universities exceed 50%. A 2025 replication of a 2004 instructor survey found that recursion is still the hardest concept to teach. Instructors also now name "teaching students to think and plan before they code" as a newer challenge. Generative AI is reshaping assessment. A Fall 2025 CS1 course (96 students) that required a 15-minute TA code-review interview after every assignment saw students score about 2% better on Exam 1 than prior semesters, despite much heavier AI use. Case-study research suggests lower-performing students who turn to AI early in problem solving show "overreliance and a failure to properly self-regulate."

**What works.** Spaced, retrieval-based practice of concepts (syntax, data structure behavior, complexity) applies here. The core skill, though, is **writing, tracing and debugging code without AI doing it for you**. Code tracing and "explain this code" prompts mirror the oral code-review format that courses are adopting. Industry interview prep (LeetCode-style) is spaced problem practice, but no rigorous studies of LeetCode itself were found.

**Pain points.** Debugging paralysis. Recursion and pointers. Starting assignments late. Over-relying on Copilot/ChatGPT, then failing paper exams or code interviews. Autograder frustration. Technical interview prep in junior/senior year. No licensure exam exists for CS.

**Student vocabulary** (common usage; not verified): PA/programming assignment, autograder, "segfault," "it compiles," debugging, office hours queue, LeetCode/"grinding," DSA, "mediums/hards," SWE internship, OA (online assessment), repo, commit, PR.

```json
{
  "archetype": "Programming",
  "majors": ["Computer science", "Software engineering", "Data science", "Information technology", "Computer engineering (software track)"],
  "assessment_types": ["Weekly programming assignments with autograders", "Written/paper coding exams (tracing, writing functions)", "Oral code-review interviews about submitted code", "Team software projects and capstones", "Data analysis notebooks and reports", "Technical interviews and online assessments (career, not course)"],
  "best_study_methods": [
    {"method": "Spaced retrieval of core concepts (syntax, data structures, complexity)", "evidence": "strong"},
    {"method": "Practice writing and tracing code without AI completion, with feedback", "evidence": "moderate"},
    {"method": "Explaining your own code aloud (code-review style self-explanation)", "evidence": "moderate"},
    {"method": "Guardrailed AI hints rather than full solutions", "evidence": "moderate"},
    {"method": "LeetCode-style daily problem grinding for interviews", "evidence": "weak"}
  ],
  "default_study_modes": ["Practice", "Quiz", "Flashcards", "Study now"],
  "learn_formats": ["Type it", "Written", "Choice"],
  "tutor_default_mode": "Practice",
  "dashboard_pinned": ["Course work", "Class updates", "Calendar/study blocks", "Exam countdown", "Continue"],
  "dashboard_tucked": ["Lectures", "Class sets", "Streaks/Progress strip", "Grades", "Plan my week", "Study now"],
  "suggested_connectors": ["Canvas", "GitHub", "Canvas calendar feed", "Google Calendar", "Slack", "Notion"],
  "major_exams": [
    {"name": "No licensure exam; technical interviews / online assessments", "typical_timing": "Sophomore-senior year internship and job recruiting cycles (timing not verified in this research pass)"},
    {"name": "GRE", "typical_timing": "Junior-senior year if applying to graduate programs that require it"}
  ],
  "pain_points": ["CS1 failure rates near or above 46-50% at some institutions", "Recursion and planning before coding", "Debugging paralysis", "Overreliance on AI leads to failing paper exams and code interviews", "Starting assignments late", "Interview-prep pressure alongside coursework"],
  "student_vocabulary": ["PA / programming assignment", "autograder", "segfault", "debugging", "office hours queue", "LeetCode / grinding", "DSA", "OA", "SWE internship", "repo", "commit", "PR"],
  "sources": [
    "https://www.mdpi.com/2076-3417/16/11/5644",
    "https://arxiv.org/html/2605.21374v1",
    "http://www.akesha.com/blog/2026/6/19/teaching-programming-with-ai-is-now-an-evidence-based-decision",
    "https://dl.acm.org/doi/10.1145/3699538.3699567",
    "https://cra.org/wp-content/uploads/2026/02/Day-2-GenAI-in-CS-Education-Porter.pdf",
    "https://www.pnas.org/doi/pdf/10.1073/pnas.2422633122",
    "https://www.hepi.ac.uk/reports/student-generative-ai-survey-2025/"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A runnable code sandbox with test cases (Practice with execution-based grading).
- A code-tracing "predict the output" format.
- A "defend your code" mock code-review interview, where the tutor asks about the student's own GitHub submission.
- A LeetCode/HackerRank progress connector.
- A Parsons-problem format (reorder lines of code).

---

## 4. Reading- and writing-heavy humanities

**Majors:** English, history, philosophy, languages, religious studies

**Narrative summary.** Assessment is dominated by essays (argumentative, close reading, research papers), seminar participation, reading responses, blue-book exams with identification and essay questions, and (for languages) vocabulary/grammar quizzes plus oral exams. The learning-science evidence is thinner here. No 2023–2026 meta-analysis of study strategies specific to university humanities was found. The best available evidence comes from a 2020 K‑12 meta-analysis: writing about content improves learning of that content (g ≈ 0.30). There is also an older finding that "writing about material read improves students' comprehension of it." The 2025 retrieval-vs-elaboration meta-analysis is useful: **free recall beats cued recall** (g = 0.23). That supports "blank page" written recall, such as writing out an argument, a historiography or a chronology from memory. Elaborative tasks were roughly as good as retrieval in most comparisons. For languages, vocabulary is a case where **spacing helps but interleaving does not** (words showed a negative interleaving effect).

**Pain points.** Heavy reading loads and the temptation to have AI summarize. In HEPI's 2025 survey, 48% of students used AI to summarize articles, a direct threat to the reading-comprehension skills these majors assess. Students also struggle with thesis formation, procrastinating on papers and timed in-class essays. AI writing tools raise integrity concerns. Grammarly is widespread, but no peer-reviewed sources on student complaints were found in this pass.

**Student vocabulary** (common usage; not verified): close reading, thesis, "the reading," response paper, seminar, blue book, IDs (identification terms), primary/secondary sources, historiography, annotating, workshop, drafts, conjugations/vocab (languages).

```json
{
  "archetype": "Reading- and writing-heavy humanities",
  "majors": ["English / literature", "History", "Philosophy", "World languages", "Religious studies", "Classics", "Comparative literature"],
  "assessment_types": ["Argumentative and research essays", "Close-reading papers", "Reading responses / discussion posts", "Seminar participation", "Blue-book exams with IDs and essay questions", "Language vocabulary/grammar quizzes", "Oral exams and presentations (languages)", "Senior thesis"],
  "best_study_methods": [
    {"method": "Free-recall writing (blank-page summaries of arguments, chronologies)", "evidence": "moderate"},
    {"method": "Writing-to-learn about course content", "evidence": "moderate"},
    {"method": "Spaced retrieval for vocabulary, terms, dates, IDs", "evidence": "strong"},
    {"method": "Elaborative interrogation (why did this happen / why does the author claim this)", "evidence": "moderate"},
    {"method": "Interleaving vocabulary lists", "evidence": "weak"}
  ],
  "default_study_modes": ["Outline", "Learn", "Flashcards", "Practice"],
  "learn_formats": ["Written", "Type it", "Flashcards"],
  "tutor_default_mode": "Explain",
  "dashboard_pinned": ["Course work", "Calendar/study blocks", "Plan my week", "Class updates", "Continue"],
  "dashboard_tucked": ["Streaks/Progress strip", "Exam countdown", "Lectures", "Class sets", "Grades", "Study now"],
  "suggested_connectors": ["Canvas", "Google Docs", "Google Drive", "Canvas calendar feed", "Google Calendar", "Notion"],
  "major_exams": [
    {"name": "GRE", "typical_timing": "Junior-senior year for graduate programs that require it (~1h58m since Sept 2023)"},
    {"name": "LSAT", "typical_timing": "Junior-senior year or gap year for law school; logic games removed Aug 2024; in-center testing for most from Aug 2026 (secondary source)"},
    {"name": "Language proficiency exams (e.g., OPI)", "typical_timing": "Varies by program (not verified in this research pass)"}
  ],
  "pain_points": ["Heavy reading loads; temptation to use AI summaries instead of reading", "Forming a thesis and structuring arguments", "Procrastination on long papers", "Timed in-class essays", "AI-integrity anxiety around writing", "Vocabulary retention in languages"],
  "student_vocabulary": ["close reading", "thesis", "the reading", "response paper", "seminar", "blue book", "IDs", "primary / secondary sources", "historiography", "annotating", "workshop", "drafts"],
  "sources": [
    "https://eric.ed.gov/?id=EJ1249514",
    "https://www.clearinghouse.edu.tum.de/wp-content/uploads/2023/08/CHU-KR-29_ENG_Graham-2020.pdf",
    "https://eric.ed.gov/?id=EJ961480",
    "https://link.springer.com/article/10.1007/s10648-025-10076-6",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf",
    "https://thecheatsheet.substack.com/p/345-88-of-students-say-they-use-generative",
    "https://www.hepi.ac.uk/reports/student-generative-ai-survey-2025/",
    "https://www.princetonreview.com/law-school-advice/lsat-logic-games-removal",
    "https://test-ninjas.com/lsat-new-format-2026-changes",
    "https://agentdock.ai/academy/gre-gmat-lsat-mcat-what-changed-and-which-one-to-sit"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A "blank page" free-recall mode, with AI comparison against source material to show what was missed.
- A thesis/argument builder and timed-essay practice with rubric-based feedback.
- Reading-check questions generated per assigned reading, to counter AI summary substitution.
- An LSAT exam-prep path (Logical Reasoning ×2, Reading Comprehension).
- Zotero/citation-manager integration.
- A spoken-response format for language oral exams.

---

## 5. Social sciences

**Majors:** psychology, sociology, political science, anthropology, criminal justice

**Narrative summary.** Assessment mixes large-lecture multiple-choice exams (especially intro psych and intro sociology), short-answer and essay exams, research methods and statistics courses, literature reviews, APA-style research papers, and occasional fieldwork or capstones. Few discipline-specific studies of study strategies were found for these majors. The general evidence applies directly, and intro-psych samples are where much of it was generated: retrieval practice, spacing and practice testing. A 2025 retrieval-practice study was done in a diverse college sample and found final-exam benefits. Statistics and research methods are the typical struggle point: a quantitative course inside a non-quantitative major. The quantitative-archetype guidance (spaced, interleaved problem practice) should apply there. HEPI found that social-science and arts students reported less familiarity with and willingness to use AI than STEM students. No licensure exam applies to most of these majors. Graduate-bound students may take the GRE, and some take the LSAT (criminal justice and political science are common pre-law routes).

**Pain points.** Concept confusion between similar theories and terms (a good fit for interleaved discrimination). Statistics anxiety. Large-lecture MCQ exams that reward precise definitions. Writing APA papers and literature reviews.

**Student vocabulary** (common usage; not verified): APA format, lit review, research methods, "stats," SPSS/R, IRB, theories/theorists, case study, fieldwork, capstone, discussion posts.

```json
{
  "archetype": "Social sciences",
  "majors": ["Psychology", "Sociology", "Political science", "Anthropology", "Criminal justice", "International relations"],
  "assessment_types": ["Large-lecture multiple-choice exams", "Short-answer and essay exams", "APA-style research papers and literature reviews", "Research methods and statistics assignments", "Discussion posts", "Fieldwork / ethnographic projects", "Capstone or honors thesis"],
  "best_study_methods": [
    {"method": "Practice testing with feedback on definitions and applications", "evidence": "strong"},
    {"method": "Spaced retrieval of key terms and theories", "evidence": "strong"},
    {"method": "Interleaving similar theories/concepts to practice discrimination", "evidence": "moderate"},
    {"method": "Elaborative interrogation and generating real-world examples", "evidence": "moderate"},
    {"method": "Spaced, interleaved practice for statistics problems", "evidence": "moderate"}
  ],
  "default_study_modes": ["Learn", "Quiz", "Flashcards", "Outline"],
  "learn_formats": ["Type it", "Written", "Choice"],
  "tutor_default_mode": "Auto",
  "dashboard_pinned": ["Study now", "Exam countdown", "Course work", "Class updates", "Calendar/study blocks"],
  "dashboard_tucked": ["Lectures", "Class sets", "Grades", "Streaks/Progress strip", "Plan my week", "Continue"],
  "suggested_connectors": ["Canvas", "Canvas calendar feed", "Google Calendar", "Google Docs", "Google Drive"],
  "major_exams": [
    {"name": "GRE", "typical_timing": "Junior-senior year for graduate programs that require it"},
    {"name": "LSAT", "typical_timing": "Junior-senior year or gap year for law school"},
    {"name": "No licensure exam at the bachelor's level (e.g., psychology licensure requires graduate training)", "typical_timing": "N/A"}
  ],
  "pain_points": ["Confusing similar theories and terms", "Statistics and research methods as the quantitative gateway", "Precise-definition MCQ exams in large lectures", "APA writing and literature reviews", "Lower AI familiarity relative to STEM peers"],
  "student_vocabulary": ["APA", "lit review", "research methods", "stats", "SPSS / R", "IRB", "theorists", "case study", "fieldwork", "capstone", "discussion posts"],
  "sources": [
    "https://journals.sagepub.com/doi/10.1177/00986283251352475",
    "https://iverson.cm.utexas.edu/courses/310M/Handouts/Dunlosky%20et%20al.%20-%202013%20-%20Improving%20Students%E2%80%99%20Learning%20With%20Effective%20Learni.pdf",
    "https://link.springer.com/article/10.1007/s10648-025-10076-6",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf",
    "https://link.springer.com/article/10.1007/s10648-025-10035-1",
    "https://www.scribd.com/document/860348019/HEPI-Policy-Note-61-1",
    "https://www.usnews.com/education/blogs/law-admissions-lowdown/articles/what-to-know-about-the-end-of-lsat-logic-games"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A "compare and contrast" discrimination drill for paired theories and terms.
- A statistics-problem Practice path with interpretation questions.
- An APA citation/format checker.
- GRE and LSAT exam-prep paths.

---

## 6. Business

**Majors:** accounting, finance, marketing, management, business economics

**Narrative summary.** Assessment includes multiple-choice and problem-based exams (accounting and finance), case analyses, group projects and presentations, Excel modeling, and (in marketing and management) papers and pitches. Introductory accounting is a recognized gateway. The Gardner Institute found an average DFWI rate of 30.17%, between chemistry and calculus. The CPA exam is the major licensure hurdle. Under CPA Evolution (since January 2024), candidates take three Core sections (AUD, FAR, REG) plus one Discipline (BAR, ISC or TCP). AICPA's 2025 cumulative pass rates were AUD 48%, FAR 42%, REG 63%, BAR 42%, ISC 68% and TCP 78%. Licensure pathways are also changing. In May 2025, AICPA and NASBA approved model legislation for a bachelor's (120 hours) + two years of experience pathway as an alternative to 150 credit hours. A secondary source reports that over half of jurisdictions had enacted it by July 2026, so the timing of CPA prep relative to graduation is shifting. MBA-bound students take the GMAT Focus Edition (since February 2024: three 45-minute sections, 2h15m) or the GRE.

**What works.** Accounting and finance behave like the quantitative archetype: spaced, interleaved problem practice (journal entries, transaction types, valuation methods), where choosing the right treatment is the hard part. Marketing and management behave more like social sciences: retrieval of frameworks plus application to cases.

**Pain points.** Intro accounting debits/credits confusion. FAR's volume. Balancing CPA prep with full-time work or busy season. Case-analysis writing. Group-project coordination.

**Student vocabulary** (common usage; not verified): journal entries, T-accounts, debits/credits, "the case," case comp, deck, Excel model, DCF, busy season, "Big 4," Becker/review course, sections (AUD/FAR/REG), NTS (notice to schedule), recruiting.

```json
{
  "archetype": "Business",
  "majors": ["Accounting", "Finance", "Marketing", "Management", "Business economics", "Information systems (business)"],
  "assessment_types": ["Problem-based exams (journal entries, calculations)", "Multiple-choice exams", "Case analyses and case competitions", "Group projects and presentations (decks)", "Excel / financial modeling assignments", "Marketing plans and papers"],
  "best_study_methods": [
    {"method": "Spaced practice testing with feedback (CPA-style MCQ and simulations)", "evidence": "strong"},
    {"method": "Interleaving transaction/problem types to practice choosing the treatment", "evidence": "moderate"},
    {"method": "Self-explanation of worked accounting/finance examples", "evidence": "moderate"},
    {"method": "Spaced retrieval of frameworks and definitions (marketing/management)", "evidence": "strong"},
    {"method": "Rereading textbook chapters / highlighting", "evidence": "weak"}
  ],
  "default_study_modes": ["Practice", "Quiz", "Flashcards", "Study now"],
  "learn_formats": ["Type it", "Choice", "Written"],
  "tutor_default_mode": "Practice",
  "dashboard_pinned": ["Course work", "Calendar/study blocks", "Exam countdown", "Class updates", "Plan my week"],
  "dashboard_tucked": ["Lectures", "Class sets", "Streaks/Progress strip", "Grades", "Study now", "Continue"],
  "suggested_connectors": ["Canvas", "Google Sheets", "Canvas calendar feed", "Google Calendar", "Gmail/Outlook", "Google Drive"],
  "major_exams": [
    {"name": "CPA Exam (AUD, FAR, REG + BAR/ISC/TCP)", "typical_timing": "Senior year, after graduation, or while working; 2025 pass rates 42-78% by section"},
    {"name": "GMAT Focus Edition", "typical_timing": "Before MBA applications, often after some work experience; 2h15m since Feb 2024"},
    {"name": "GRE", "typical_timing": "Alternative to GMAT for many business programs"},
    {"name": "CFA Level I", "typical_timing": "Final year of undergrad or after (timing not verified in this research pass)"}
  ],
  "pain_points": ["Intro accounting as gateway (avg DFWI ~30%)", "Debits/credits and transaction-type confusion", "FAR volume and low pass rates", "Balancing CPA prep with work and busy season", "Case writing and group coordination", "Shifting licensure pathways (150 vs 120+2)"],
  "student_vocabulary": ["journal entries", "T-accounts", "debits / credits", "the case", "case comp", "deck", "Excel model", "DCF", "busy season", "Big 4", "sections (AUD/FAR/REG)", "NTS", "recruiting"],
  "sources": [
    "https://umaine.edu/provost/wp-content/uploads/sites/14/2018/11/Gardner-Institute-Digging-into-the-Disciplines-The-Impact-of-Gateway-Courses-in-Accounting-Calculus-and-Chemistry-on-Student-Success-.pdf",
    "https://www.aicpa-cima.com/professional-insights/article/the-new-cpa-exam-two-years-in",
    "https://300hours.com/cpa/",
    "https://www.surgent.com/exam-review/cpa-review/blog/cpa-exam-pass-rates/",
    "https://www.cpacredits.com/resources/the-evolution-of-the-150-hour-rule-for-cpa-licensure/",
    "https://www.vscpa.com/news/7fe33b91-5e28-42e9-9813-78c33cd9cd3f:a-new-era-of-cpa-licenses-alternative-pathway-and-cpa-evolution",
    "https://modusalliance.com/insights/new-path-to-cpa-150-hour-rule/",
    "https://agentdock.ai/academy/gre-gmat-lsat-mcat-what-changed-and-which-one-to-sit",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf"
  ]
}
```

**Proposed additions (not current Cordia features):**
- CPA task-based simulation practice (spreadsheet-style).
- A journal-entry builder format.
- A case-analysis practice mode with rubric feedback.
- CPA and GMAT exam-prep paths.
- A "busy season" low-volume plan setting for working candidates.

---

## 7. Arts, studio and design

**Majors:** studio art, graphic design, architecture, music, theatre, film

**Narrative summary.** This archetype is the least exam-driven. Assessment centers on **critiques**: desk crits, pin-ups, juries and final reviews. It also includes portfolio reviews, performances and juries (music), productions (theatre), and screenings (film), with exams only in history and theory courses and some technical courses (music theory, structures). The 2023–2026 research is mostly from architecture. A 2024 peer-reviewed mixed-methods study of architecture and landscape-architecture students (DASS‑21, n = 399) found that "33%, 46%, and 33% of students screened positive for moderate to extremely severe levels of depression, anxiety, and stress, respectively." It attributed this partly to "pedagogical approaches, learning and teaching culture, studio environment, and lifestyle choices." Students describe reviews as anxiety peaks and studio culture as "all-consuming," crowding out "sleep and eat." Students prefer formative desk crits to summative juries: in a 2024 study, 68% strongly agreed desk critique is more beneficial than pin-up critique, and summative jury critiques are "frequently" found frustrating. The AIAS's most recent national survey (2020) lists lack of sleep and financial burden as stressors and notes that "studio courses supersede lecture courses, and students fail other classes." No 2023–2026 peer-reviewed work on fine-art (BFA/MFA) crits specifically was found.

**What works.** The most relevant learning-science finding is that **interleaving works best for visual category learning** (paintings g = 0.67). Interleaving artists, styles and periods is ideal for art and architecture history slide IDs. Spaced retrieval applies to history and theory exams. For the studio work itself, the evidence supports planning and time management (spreading work across the project, not all-nighters), but no rigorous studies of "study methods" for studio production were found.

**Pain points.** All-nighters before reviews. Crit anxiety, especially for first-years unfamiliar with presenting. Studio time squeezing out other courses (which then show up as grade drops in Canvas). Material costs. Portfolio deadlines.

**Student vocabulary** (common usage, partly verified via sources: "crit," "jury," "desk crit," "pin-up," "review"; others not verified): crit, desk crit, pin-up, jury, final review, studio, all-nighter, precedent, parti, model, boards, portfolio review, juries (music), rehearsal, call time, dailies, rough cut.

```json
{
  "archetype": "Arts, studio and design",
  "majors": ["Studio art", "Graphic design", "Architecture", "Interior / industrial design", "Music (performance, theory)", "Theatre", "Film / media production"],
  "assessment_types": ["Desk critiques and pin-ups", "Juries and final reviews", "Portfolio reviews (mid-program and graduation)", "Performances and music juries", "Productions and screenings", "Art/architecture history exams with slide IDs", "Music theory and technical exams", "Process books and artist statements"],
  "best_study_methods": [
    {"method": "Interleaving artists/styles/periods for visual identification", "evidence": "moderate"},
    {"method": "Spaced retrieval for history and theory exams (slide IDs, terms)", "evidence": "strong"},
    {"method": "Distributed work across a project instead of all-nighters", "evidence": "moderate"},
    {"method": "Frequent formative feedback (desk crits) over single summative juries", "evidence": "weak"}
  ],
  "default_study_modes": ["Flashcards", "Learn", "Quiz", "Outline"],
  "learn_formats": ["Flashcards", "Choice", "Written"],
  "tutor_default_mode": "Plan",
  "dashboard_pinned": ["Calendar/study blocks", "Plan my week", "Course work", "Class updates", "Continue"],
  "dashboard_tucked": ["Exam countdown", "Streaks/Progress strip", "Study now", "Grades", "Lectures", "Class sets"],
  "suggested_connectors": ["Canvas", "Google Calendar", "Apple Calendar", "Canvas calendar feed", "Google Drive", "Dropbox", "Notion"],
  "major_exams": [
    {"name": "Portfolio reviews (sophomore/mid-program and graduation)", "typical_timing": "Typically mid-program and final year (varies by school; not verified in this research pass)"},
    {"name": "ARE (Architect Registration Examination)", "typical_timing": "During or after professional degree and experience (timing not verified in this research pass)"},
    {"name": "Music juries / auditions", "typical_timing": "End of each semester in many programs (not verified in this research pass)"}
  ],
  "pain_points": ["All-nighters and sleep deprivation before reviews", "Crit and jury anxiety, especially for first-years", "Studio time crowding out other courses", "High rates of anxiety/depression/stress in architecture students", "Material costs", "Portfolio deadlines"],
  "student_vocabulary": ["crit", "desk crit", "pin-up", "jury", "final review", "studio", "all-nighter", "precedent", "parti", "boards", "portfolio review", "juries (music)", "rough cut"],
  "sources": [
    "https://bhacjournal.org/article/4851/galley/5381/download/",
    "https://doaj.org/article/c51445c3908f49e4932041aa968b3bef",
    "https://dergipark.org.tr/en/download/article-file/3911323",
    "https://eajse.tiu.edu.iq/index.php/eajse/article/download/430/387/936",
    "https://www.researchgate.net/publication/376554037",
    "https://zenodo.org/records/8412071",
    "https://www.aias.org/wp-content/uploads/2020/07/LTCPP-2020-Survey-Results-1.pdf",
    "https://dailytrojan.com/2025/03/03/the-architecture-school-expanded-counseling-hours-and-made-it-easier-for-students-to-access-supplies-in-response-to-criticism/",
    "https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf",
    "https://www.scribd.com/document/860348019/HEPI-Policy-Note-61-1"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A project-milestone planner that works backward from review dates and flags all-nighter risk.
- Crit/presentation rehearsal: the tutor asks likely jury questions about uploaded work.
- An image-based slide-ID flashcard format with interleaved artists/periods.
- A portfolio progress tracker.
- Figma/Adobe Creative Cloud connectors.
- A practice log for music and theatre (minutes practiced, repertoire).

---

## 8. Education

**Majors:** elementary/secondary education, special education, early childhood

**Narrative summary.** Assessment includes lesson plans and unit plans, field experience and practicum observations, student teaching evaluations, reflective journals, portfolios, content and pedagogy exams, and a performance assessment in some states. The licensure landscape is in flux. Georgia, New Jersey, New York, Washington and Wisconsin have dropped edTPA since 2022. Tennessee removed it for in-state completers effective July 1, 2026, and Illinois suspended it. Meanwhile "more than 40 states require aspiring teachers to take the costly Praxis Subject test," and New Jersey removed the Praxis Core. About half of the states that required a standardized performance assessment in 2019 no longer do. Cordia's exam paths must therefore be **state-aware**. edTPA pain points are documented mostly in pre-2023 studies: 71% of candidates in one study felt edTPA interfered with student teaching, and candidates reported "sleep deprivation, stress." A 2024 longitudinal study tracks stress across five cohorts, but I saw only its abstract. A small 2025 study (N = 44) found test anxiety was a significant source of math anxiety for preservice teachers taking Praxis Core math.

**What works.** Spaced retrieval and practice testing for content exams (Praxis Subject, state tests) are strongly supported in general. Writing-to-learn supports reflective and pedagogical writing. Notably, education majors are the future teachers who are most exposed to the learning-styles myth. In Newton & Salvi's 2020 systematic review (*Frontiers in Education*), 89.1% of 15,045 educators surveyed between 2009 and early 2020 said they believed people learn better when taught in their preferred learning style. Cordia can teach the evidence-based alternative by example.

**Pain points.** Student-teaching semester overload (full-time teaching + coursework + licensure tasks). Math anxiety on Praxis Core/elementary math. Confusing, state-specific licensure requirements. Lesson-plan formatting.

**Student vocabulary** (common usage; not verified): lesson plans, unit plans, objectives, standards, practicum, field placement, student teaching, cooperating teacher, observations, edTPA, Praxis, IEP, differentiation, classroom management, reflection.

```json
{
  "archetype": "Education",
  "majors": ["Elementary education", "Secondary education (content area)", "Special education", "Early childhood education", "Physical education"],
  "assessment_types": ["Lesson plans and unit plans", "Field experience / practicum observations", "Student teaching evaluations", "Reflective journals and papers", "Teaching portfolios and video analysis", "Content and pedagogy licensure exams", "Performance assessments (edTPA/PPAT where required)"],
  "best_study_methods": [
    {"method": "Spaced practice testing for Praxis/state content exams", "evidence": "strong"},
    {"method": "Writing-to-learn and reflective writing about content and pedagogy", "evidence": "moderate"},
    {"method": "Interleaved math practice for elementary math content tests", "evidence": "moderate"},
    {"method": "Learning-styles-based lesson design", "evidence": "weak"}
  ],
  "default_study_modes": ["Quiz", "Learn", "Flashcards", "Outline", "Study now"],
  "learn_formats": ["Choice", "Type it", "Written"],
  "tutor_default_mode": "Plan",
  "dashboard_pinned": ["Plan my week", "Calendar/study blocks", "Course work", "Exam countdown", "Class updates"],
  "dashboard_tucked": ["Lectures", "Class sets", "Streaks/Progress strip", "Grades", "Study now", "Continue"],
  "suggested_connectors": ["Canvas", "Google Calendar", "Google Docs", "Google Drive", "Canvas calendar feed", "Gmail/Outlook"],
  "major_exams": [
    {"name": "Praxis Core (or state basic skills; waived or removed in some states, e.g., NJ)", "typical_timing": "Before admission to the teacher-prep program, often first-second year"},
    {"name": "Praxis Subject Assessments / state content tests", "typical_timing": "Junior-senior year before or during student teaching; required in more than 40 states"},
    {"name": "edTPA / PPAT (only where still required)", "typical_timing": "During the student-teaching semester; dropped in GA, NJ, NY, WA, WI since 2022 and in TN from July 1, 2026"}
  ],
  "pain_points": ["Student-teaching semester overload", "Performance-assessment stress where edTPA is still required", "Math anxiety on Praxis Core / elementary math", "Confusing state-by-state licensure rules", "Lesson-plan formatting and standards alignment"],
  "student_vocabulary": ["lesson plans", "unit plans", "objectives", "standards", "practicum", "field placement", "student teaching", "cooperating teacher", "observations", "edTPA", "Praxis", "IEP", "differentiation", "classroom management"],
  "sources": [
    "https://stateline.org/2025/05/21/as-teacher-burnout-deepens-states-scramble-to-fill-school-job-vacancies/",
    "https://policylab.rutgers.edu/publication/new-jersey-joins-the-move-away-from-standardized-performance-assessments-for-teacher-licensure/",
    "https://mastersineducation.org/articles/tennessee-teacher-licensing-2026-07-27/",
    "https://www.edtpa.com/PageView.aspx?f=GEN_Illinois.html",
    "https://www.weareteachers.com/teacher-certification-exams/",
    "https://www.tandfonline.com/doi/abs/10.1080/10632913.2024.2408542",
    "https://www.ascd.org/el/articles/the-consequences-of-edtpa",
    "https://www.mdpi.com/2227-7102/15/9/1227",
    "https://eric.ed.gov/?id=EJ1249514",
    "https://pulsesrx.com/2025/04/29/debunking-the-myth-the-truth-about-learning-styles/",
    "https://poorvucenter.yale.edu/teaching/teaching-resource-library/learning-styles-as-a-myth"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A state-aware licensure requirements checker.
- Praxis Core/Subject exam-prep paths.
- A lesson-plan builder/checker aligned to standards.
- A student-teaching "survival" plan that compresses study into short sessions.
- An edTPA/PPAT task tracker where still required.

---

## 9. Undeclared and general education

**Majors:** first-year and gen-ed students, undecided majors

**Narrative summary.** These students take the broadest mix: intro writing/composition, intro math (often the gateway), intro sciences, and survey courses in social sciences and humanities. Their assessments therefore span every archetype above. The first year is where gateway outcomes compound. Among calculus students dismissed after their first year, 95% were in the DFWI group. Among students in good standing who chose not to return, 50% had a DFWI in calculus. The Gardner study also found low-income and first-generation students had disproportionately high DFWI rates. Many of these students arrive with high school habits (rereading, highlighting), and 45% of UK students in HEPI 2025 had already used AI at school. For Cordia's possible high-school expansion: the ACT became the "Enhanced ACT" in 2025. It has 44 fewer questions, Science is optional, and the composite averages English, Math and Reading only. All test-takers have used this format since September 2025.

**What works.** This group is the best place to *teach* study strategies explicitly, because they haven't settled into major-specific routines. Practice testing and spacing are the strong defaults. Strategy instruction matters because belief in rereading and learning styles is widespread. Instruction should be framed around behaviors, never "your learning style."

**Pain points.** Transition shock (less structure, fewer graded checkpoints). Not knowing how to study for college exams. Gateway math. Time management across 4–5 unrelated courses. Major uncertainty.

**Student vocabulary** (common usage; not verified): gen eds, core/distribution requirements, intro classes, "weed-out," syllabus, midterms, office hours, advising, declaring, prereqs, GPA, add/drop.

```json
{
  "archetype": "Undeclared and general education",
  "majors": ["Undeclared / exploratory", "First-year general education", "General studies / liberal studies", "High school students (future expansion)"],
  "assessment_types": ["Mixed: MCQ exams in intro sciences and social sciences", "Composition essays and drafts", "Gateway math exams and online homework", "Labs in intro sciences", "Discussion posts and quizzes", "ACT/SAT (high school)"],
  "best_study_methods": [
    {"method": "Practice testing (self-quizzing) instead of rereading", "evidence": "strong"},
    {"method": "Spaced study sessions across the week", "evidence": "strong"},
    {"method": "Explicit study-strategy instruction framed around behaviors", "evidence": "moderate"},
    {"method": "Highlighting and rereading as main strategies", "evidence": "weak"},
    {"method": "Learning-styles matching", "evidence": "weak"}
  ],
  "default_study_modes": ["Study now", "Learn", "Quiz", "Flashcards"],
  "learn_formats": ["Choice", "Type it", "Flashcards"],
  "tutor_default_mode": "Auto",
  "dashboard_pinned": ["Continue", "Class updates", "Course work", "Plan my week", "Streaks/Progress strip"],
  "dashboard_tucked": ["Lectures", "Class sets", "Grades", "Exam countdown", "Calendar/study blocks", "Study now"],
  "suggested_connectors": ["Canvas", "Canvas calendar feed", "Google Calendar", "Apple Calendar", "Google Tasks"],
  "major_exams": [
    {"name": "ACT (Enhanced) / SAT", "typical_timing": "High school junior-senior year; Enhanced ACT for all test-takers since Sept 2025"},
    {"name": "Placement exams (math, language)", "typical_timing": "Before or at the start of first year (not verified in this research pass)"}
  ],
  "pain_points": ["Transition from high school structure", "Not knowing how to study for college exams", "Gateway math and science DFWI linked to first-year attrition", "Disproportionate DFWI for first-gen and low-income students", "Time management across unrelated courses", "Major uncertainty"],
  "student_vocabulary": ["gen eds", "core / distribution requirements", "intro classes", "weed-out", "syllabus", "midterms", "office hours", "advising", "declaring", "prereqs", "GPA", "add/drop"],
  "sources": [
    "https://www.everylearnereverywhere.org/blog/what-are-gateway-courses-and-why-do-they-matter-to-equity-in-higher-ed/",
    "https://umaine.edu/provost/wp-content/uploads/sites/14/2018/11/Gardner-Institute-Digging-into-the-Disciplines-The-Impact-of-Gateway-Courses-in-Accounting-Calculus-and-Chemistry-on-Student-Success-.pdf",
    "https://eric.ed.gov/?id=ED671617",
    "https://studentblog.act.org/the-new-act-test",
    "https://www.learner.com/blog/act-2025-changes",
    "https://gradesnova.com/exams/act/enhanced-act",
    "https://www.sciencedaily.com/releases/2013/01/130110111734.htm",
    "https://www.techlearning.com/news/busting-the-myth-of-learning-styles"
  ]
}
```

**Proposed additions (not current Cordia features):**
- A "how to study in college" onboarding micro-course.
- A major-explorer that infers archetype fit from course performance.
- An ACT/SAT exam-prep path (Enhanced ACT format).
- A weekly "too many courses" load balancer.
- An advising-meeting prep checklist.

---

## Details: Exam Landscape Changes Cordia Must Track

- **NCLEX:** NGN since April 1, 2023. 2025 first-time U.S. RN pass rate 86.7% (down from 91.2%), all candidates 69.1%. PN first-time U.S. 86.6%.
- **Bar:** The NextGen UBE first ran July 28–29, 2026, with 2,640 examinees across 10 jurisdictions. 52 jurisdictions will adopt it by July 2028, and the legacy UBE runs through February 2028. A secondary source reports a 72.7% pass rate for the first administration; treat this as unverified until NCBE confirms it. Paths must branch on legacy vs. NextGen by jurisdiction.
- **LSAT:** Logic games removed August 2024 (two Logical Reasoning + one Reading Comprehension scored). A secondary source reports in-center testing for nearly all from August 2026.
- **MCAT:** Test dates January–September. Scores in 30–35 days. Typical spring of junior year.
- **CPA:** CPA Evolution since January 2024. 2025 pass rates 42–78% by section. 120+2 pathway spreading.
- **GMAT Focus:** Since February 2024, 2h15m. **GRE:** Shortened to about 1h58m (September 2023).
- **PCAT:** Retired January 10, 2024.
- **ACT:** Enhanced format with optional Science, fully rolled out September 2025.
- **FE:** Year-round computer-based testing. Senior year is optimal.
- **Praxis/edTPA:** Strongly state-dependent and shrinking.

---

## What Cordia Should Do

### 1. Onboarding (5–7 minutes, behavior-based, no learning-styles quiz)

**Ask directly:**
- Major (map it to one of the nine archetypes; allow two for double majors).
- Year.
- Target exams and dates (prefilled from the archetype, e.g., nursing → NCLEX; junior pre-med → MCAT).
- Goals: pass / raise GPA / ace a gateway course / licensure.
- Weekly hours available.
- Fixed commitments (clinicals, student teaching, studio, work/busy season).

**Ask indirectly (research-backed, about behavior, not preference):**
1. "The night before an exam, what do you usually do first?" Options: reread notes/slides · highlight or rewrite notes · make or use flashcards · do practice problems/questions · ask AI to summarize. This detects reliance on rereading/highlighting, which are low utility.
2. "How many days before an exam do you usually start studying?" This detects massed vs. spaced study.
3. "When you get a practice question wrong, what do you do?" Options: look at the answer and move on · redo it later · find out why · skip. This detects use of feedback.
4. "When you use ChatGPT or other AI for homework, which is closest?" Options: I ask for the answer · I ask for hints · I ask it to check my work · I don't use it. This sets AI guardrail intensity. Bastani et al. found unguarded answer-seeking harmed exam performance.
5. A **3-question calibration probe** from the student's own uploaded material with Sure/Think so/Guess ratings. This produces an initial overconfidence estimate, measured rather than self-reported.

**Never ask** "Are you a visual, auditory or kinesthetic learner?" If students volunteer it, respond with a one-line reframe: "Everyone learns better by testing themselves. We'll use visuals where the content is visual."

### 2. Per-major dashboard defaults (fully editable)

Use the cross-archetype table below as the default layout. Implementation rules:
- **Archetype sets the initial pins.** Canvas signals override them dynamically. For example, "exam in N days" (from Canvas or the calendar feed) promotes **Exam countdown** and **Study now** to the top for any major within 14 days of an exam.
- **Studio and education majors default to planning elements** (Plan my week, Calendar/study blocks), because their risk is time collapse before reviews and during student teaching, not recall.
- **Grades are tucked by default** for every archetype except where the student sets "raise GPA" as a goal. Showing grades constantly is not evidence-backed, and grade data still drives the feedback loop in the background.
- Log every edit students make to the layout. Over time, the most common edits within an archetype should update that archetype's defaults.

### 3. Study-plan logic for any test

**Inputs:** diagnostic results, material (Canvas modules and uploads), profile (archetype, hours, commitments), test date, and the Canvas assignment calendar.

**Algorithm:**
1. **Map material into "ideas" (concepts) and "problem types."** The archetype determines the mix. Memorization-heavy, social science and humanities-ID material is mostly ideas. Quantitative, programming and accounting material is mostly problem types.
2. **Diagnostic first** (a short mixed quiz with confidence ratings). Classify each idea as unknown / fragile (correct but "Guess") / overconfident (wrong but "Sure") / mastered. Prioritize overconfident and fragile items.
3. **Schedule backward from the test date with expanding spacing.** Every idea gets at least 3 retrieval sessions on separate days before the exam. If too few days remain, reduce scope by prioritizing high-weight material rather than cramming everything.
4. **Format by archetype:**
   - Memorization-heavy: recall-based Learn → Flashcards → NCLEX/application questions.
   - Quantitative/programming/accounting: Practice with **interleaved problem types**, added after initial blocked introduction. Spacing is the non-negotiable element. Pure fact retrieval is a weaker lever in math.
   - Humanities: written free recall and outline-based argument practice.
   - Vocabulary-type content (languages, terminology): spaced but **not interleaved**.
5. **Final 48 hours:** a full timed mixed practice test, then targeted review of misses. No new material.
6. **Respect load:** when Canvas shows a lab report, paper or studio review due that week, shrink the session length and keep the spacing.

### 4. Grade feedback loop (study behavior → Canvas grade)

**What to log per assessment:**
- Total study minutes.
- Number of distinct study days (spacing).
- Share of time in retrieval/practice vs. passive review.
- First-try accuracy.
- Calibration (accuracy on "Sure" items).
- Days between last session and exam.
- AI tutor mode usage (hints vs. answers).

**How to learn what works for an individual:**
- Treat each graded exam as one data point. Compare within the student, across exams and courses in the same archetype.
- Show results as **hypotheses, not verdicts**. For example: "On your last 3 exams, the ones you studied across 4+ days averaged 9 points higher." Show the n.
- Do not claim causation. Course difficulty, instructor and exam format confound everything.
- Require at least 3 graded assessments before personal recommendations override evidence-based defaults.
- **Never let personal data push a student toward a low-utility method.** If rereading appears to "work" for someone, the system should say so but still schedule retrieval. Rereading's apparent success is often fluency, not learning.
- Use Canvas alerts (grade dropped, missing work) as triggers to offer a plan, not as shame notifications.
- For studio majors, track grade drops in *non-studio* courses during review weeks. That is the documented failure pattern.

### 5. Expert-verified exam prep paths (priority order)

1. **NCLEX-RN/PN.** Largest population, high stakes, and a 2025 pass-rate decline. Include NGN item types and a readiness score from first-try accuracy plus calibration.
2. **MCAT.** Plans of about 240–300 hours anchored to a test date (January–September). The AAMC survey average is 20 hours a week for three months; ~300 hours is a prep-company benchmark.
3. **CPA (by section).** FAR and AUD first, since most candidates start there and pass rates are lowest.
4. **ACT (Enhanced)** for the high-school expansion.
5. **LSAT** (post-2024 format).
6. **Bar.** Branch legacy UBE vs. NextGen by jurisdiction. Launch NextGen first for the 2026–2027 adopting jurisdictions.
7. **FE** (discipline-specific).
8. **Praxis** (state-aware).
9. **GRE and GMAT Focus.**

**Expert verification:**
- Each path needs a named credentialed reviewer per section (e.g., an RN educator for NCLEX).
- Each path needs a public "last verified against [test-maker] blueprint on [date]" stamp.
- Paths need a change-log, because exams changed repeatedly in 2023–2026 (NGN, LSAT, GMAT, GRE, ACT, CPA, bar).
- Prep materials built before mid-2024 can teach sections that no longer exist.

### 6. AI tutor guardrails (all archetypes)

- Default the tutor to **hints and questions before answers** in Practice mode. Reveal answers only after an attempt.
- In programming, add "explain your code" checks that mirror the oral code-review assessments courses are adopting.
- In humanities, never produce a full essay. Do offer outline critique and free-recall comparison.

### Cross-archetype comparison of defaults

| Archetype | Default study modes | Learn formats | Tutor default | Top pinned | Key connector beyond Canvas | Biggest exam |
|---|---|---|---|---|---|---|
| 1. Memorization-heavy science/health | Learn, Flashcards, Quiz, NCLEX, Study now | Type it, Flashcards, Choice | Retain | Study now, Exam countdown | Google/Apple Calendar | NCLEX, MCAT |
| 2. Quantitative | Practice, Quiz, Study now, Outline | Written, Type it, Choice | Practice | Course work, Exam countdown | Google Drive | FE |
| 3. Programming | Practice, Quiz, Flashcards, Study now | Type it, Written, Choice | Practice | Course work, Class updates | GitHub | (Interviews) |
| 4. Humanities | Outline, Learn, Flashcards, Practice | Written, Type it, Flashcards | Explain | Course work, Calendar/study blocks | Google Docs | GRE, LSAT |
| 5. Social sciences | Learn, Quiz, Flashcards, Outline | Type it, Written, Choice | Auto | Study now, Exam countdown | Google Docs | GRE, LSAT |
| 6. Business | Practice, Quiz, Flashcards, Study now | Type it, Choice, Written | Practice | Course work, Calendar/study blocks | Google Sheets | CPA, GMAT |
| 7. Arts/studio/design | Flashcards, Learn, Quiz, Outline | Flashcards, Choice, Written | Plan | Calendar/study blocks, Plan my week | Dropbox / Google Drive | Portfolio reviews |
| 8. Education | Quiz, Learn, Flashcards, Outline, Study now | Choice, Type it, Written | Plan | Plan my week, Calendar/study blocks | Google Docs | Praxis (edTPA where required) |
| 9. Undeclared/gen-ed | Study now, Learn, Quiz, Flashcards | Choice, Type it, Flashcards | Auto | Continue, Class updates | Google Tasks | ACT/SAT (HS) |

---

## Caveats

- **Student vocabulary and tool complaints are mostly unsourced.** Within the research budget I could not find rigorous 2025–2026 sources on student slang or on complaints about Quizlet, Chegg, UWorld, Grammarly, Notion or Khan Academy. Those lists reflect common usage and should be validated with 5–10 student interviews per archetype before they are used in UI copy.
- **Several figures come from secondary sources:** Anki usage (68.3%), the NextGen bar first-administration pass rate (72.7%), the LSAT in-center change, the "over half of jurisdictions" CPA pathway figure, and the FE fiscal-2025 pass-rate table, which comes from prep sites rather than NCEES directly. The interleaving result (61% vs. 38%) is from a primary randomized trial (Rohrer et al., 2020), but in seventh graders. Verify these against primary sources (NCBE, LSAC, AICPA/NASBA, NCEES, original papers) before putting them in marketing.
- **Some core evidence is older but still foundational:** Dunlosky et al. (2013), Brunmair & Richter (2019), Graham et al. (2020) and the Gardner Institute gateway study (2018). The DFWI figures in particular are pre-pandemic averages and vary widely by institution.
- **Anki–board-score studies are correlational,** with self-selection. Highly motivated students both use Anki and score higher.
- **The PNAS AI study was in high school math (Turkey).** Generalizing it to college majors is reasonable but not proven.
- **Arts and education evidence is thin and mostly architecture- or K‑12-based.** Studio-specific "study method" research is essentially absent. The humanities have no university-level strategy meta-analysis.
- **Licensure rules (Praxis/edTPA, CPA pathways, bar adoption) change state by state, often yearly.** Any path Cordia ships needs an owner and a review cadence.
