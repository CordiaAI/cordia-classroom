# Cordia Classroom: The Complete Brief

*Project knowledge for Claude. Last updated October 29, 2026. Covers the product, how students use it, the study science, the AI pipeline, the architecture, the data model, plans and pricing, the Cordia Assistant, current metrics, known problems, the roadmap, and the design for an adaptive learning engine.*

---

## 1. What Cordia Classroom is

Cordia Classroom is a study platform for college students. A student brings in course material from anywhere: a Canvas or Blackboard page, a slide deck, a PDF, a Word file, a recorded lecture, pasted notes or a YouTube video. Cordia turns it into a **study guide**, which is an outline plus a complete set of test questions and answers. The student then studies that guide in several modes built on learning science. Learn is a mastery ladder. Flashcards use spaced review. Quiz re-asks every miss. Practice is a drawing board with AI grading. NCLEX practice is for nursing students.

Around the study core, Cordia connects to the student's school life:
- It reads Canvas for assignments, grades, announcements and exams.
- It turns deadlines into plans, puts study time on the calendar, and warns about grade drops and date changes.
- It offers an AI **Tutor** that answers from the student's own material.
- A companion app, the **Cordia Assistant**, texts the student by SMS with reminders, plans and check-ins.

**The promise in one line:** any page, slide or document becomes a complete, accurate study guide with no hallucination and full coverage, and Cordia helps you actually learn it before the test.

**Core principles the product is built on:**
1. **Zero hallucination.** Every question and answer must be directly supported by the source material. The AI is told to use only explicitly stated facts.
2. **Full coverage, based on an inventory.** Question generation first lists every testable concept, then writes one question per concept. There are no fixed question counts.
3. **Domain-neutral.** Prompts and features must work equally for nursing, art history, business law, literature and computer science. Discipline-specific wording is not allowed.
4. **Learning science first.** Recall beats recognition, misses come back, confidence is measured, spaced review keeps things fresh, and only first tries count toward scores.
5. **Honest study aid.** The Honor Code forbids submitting AI content as your own or using Cordia during live exams. Instructors can turn off sharing for their course.

**Brand and domains:**
- Product name: Cordia Classroom (part of "Cordia").
- Canonical site: `https://classroom.cordiaai.io`. Legacy domains `classroom.cordiacode.com` and `autostudyai.online` redirect or are still allowed.
- The backend API is at `autostudy-ai.fly.dev`; the backend still carries the original project name "AutoStudy AI".
- Bare `cordiaai.io` redirects to the Assistant.
- Support email: support@cordiaai.io.

---

## 2. Who uses it and how (the student journey)

**Typical student:** an undergraduate juggling 4–6 classes, many on Canvas, some with a lot of slides and readings. Nursing students are a notable group: NCLEX mode appears automatically when the material is detected as nursing.

**The core loop:**
1. **Bring in material.** Use the Chrome extension on a course page, upload a file, paste text, record a lecture, or import from Canvas, Drive, Docs or Notion.
2. **Cordia builds the guide.** Steps shown: "Reading your material → Finding the key ideas → Writing questions and answers → Making flashcards". The build continues in the background if the student closes the sheet.
3. **Check yourself.** A new guide opens on five quick questions spread across the material, and the student can skip to reading.
4. **Study.** Read the Outline, then Learn, Flashcards, Quiz or Practice. Highlight any line to Visualize it, Explain it, make a card from it, or Ask the Tutor.
5. **Stay on track.** The Dashboard shows course work, alerts (exam in N days, grade dropped, date changed), streaks, and "Study now", which is a mixed review of due cards, quiz misses and open practice.
6. **Before the exam.** Build a review set from the exam alert, set a test date in Learn, follow the daily pacing, and finish with a Final check (Quiz).

---

## 3. Every way to bring material in

- **The New sheet** (the "New" button in the sidebar, or the centre tab on phones) offers four big options plus a sample:
  - **Upload:** up to 5 files at once. Accepts PDF, DOC/DOCX, PPT/PPTX, TXT, MD, RTF and images (PNG, JPG, WEBP, HEIC). Audio files are sent to Record. Scanned PDFs (no text layer) are transcribed page by page with AI vision.
  - **Paste:** any text; AI writes the title.
  - **Link:** a web page, PDF, YouTube video or Quizlet set. Quizlet links go to the card importer. YouTube transcripts are read through the extension.
  - **Record:** a lecture, with a consent screen ("I have permission to record this lecture").
    - Record, pause, resume and stop; minimise to a recording pill so you can take notes elsewhere.
    - The microphone reconnects itself if it drops, recording continues offline, and you can upload an existing recording (mp3/m4a/wav/webm).
    - If server transcription isn't available, it falls back to the browser's own speech recognition.
  - **Try a sample:** a ready-made sample guide.
  - Optional **Class** picker.
  - Shortcuts to make a Quiz on the last guide, Flashcards (written by hand), Practice, or a Note.
- **Write cards / Import from Quizlet** (`/create`):
  - Write term/definition cards by hand, up to 100, with photos on either side. Enter moves to the next field.
  - Import a Quizlet set from its link (read through the extension) or from pasted export text.
  - This page is also the editor for existing guides.
- **Notes:** New › Note makes a guide that holds only your own notes. Later, **Make it an outline** and **Make flashcards and quiz** turn it into a full guide.
- **Lectures** (Library › Lectures): **Add notes** by pasting notes or a transcript, with date and class.
- **Canvas:** **Make guide** on any course file. A per-class toggle, **Bring module files into Library**, auto-imports module files.
- **Connectors:**
  - Search Google Drive, Google Docs or Notion and add files to a class, or create a guide (review it first).
  - Drive and Dropbox can link a **class folder**; new files arrive every 30 minutes.
- **Chrome extension:** the main capture tool (see section 9).
- **The Tutor:** files dropped on the Tutor are attached to the chat, and the Tutor can **build a guide** or a practice set on request.

---

## 4. The study guide (what Cordia produces)

A guide (`study_guides` row) contains:
- **Title:** AI-named when the original title is weak, for example a file name.
- **Outline (Notes):** a structured outline with an overview, 3–12 sections and 4–8 key points each. It can be edited (Heading, Bullet, Detail, with undo) and regenerated with undo. The Tutor can edit it on request.
- **Questions and answers:** the heart of the guide, stored as `Q1:` / `A1:` text.
  - Answers are trimmed to about 3 sentences or 350 characters; quoted passages stay word for word.
  - Every question stands alone, never "Problem 4" or "Slide 5".
- **Flashcards:** derived directly from the Q/A pairs, so cards always match the guide. Cards can have photos.
- **Cached quiz:** multiple-choice wrong options (AI-written, or built from other answers).
- **Progress:**
  - `flashcard_progress`: known/unknown lists, the Leitner schedule, and Learn levels plus test date.
  - `read_progress`, `practice_state`.
- **Source info:** the type (file, webpage, canvas_module, lecture, pasted_text, review…), the source title and URL.

**Guide page layout:**
- **Header:** click the title to rename, Star, a ⋯ menu (Edit, Add/Move to class, Export, Delete), and **Study now**.
  - Export goes to Markdown, Google Docs, Notion, or a copy saved to Drive.
- **Tabs:** Outline · Learn · Flashcards · Quiz · Practice. NCLEX appears for nursing material. Games is hidden behind a flag.
- **Outline / By page switch:**
  - *Outline* view: the editable outline.
  - *By page* view: 3 questions per page, a page list, and Got it / Explain on each question.
- **Highlight menu:** select text to get **Visualize · Explain · Make card · Ask**.
  - **Visualize** draws an AI diagram (Napkin) beside the highlighted line. You can redraw up to 3 times, Keep, drag, resize, view full size, and download as SVG or PNG. It counts against a monthly visual limit.
  - **Explain** opens "Learn it your way" with four views: Diagram (fill in the blanks), Listen (read aloud, answer by voice), Notes (fill-in summary) and Real life (apply the idea).
  - **Make card** adds a flashcard.
  - **Ask** sends the line to the Tutor.
- **Sharing chip:** Private / Share with {course code}. Shared guides show "Update available" when the author changes them.
- **Class suggestion chip:** auto-files the guide into a class, with Undo.

---

## 5. Study modes

### 5.1 Learn (the main mode, launched October 2026)

A mastery ladder modelled on Quizlet's Learn but stricter, because it's designed to get students ready for a test.

- **Levels:** New → Learning → Familiar → Mastered.
- **Rounds:** 7 ideas per round. Misses come back near the end of the same round. After each round a **checkpoint** shows which ideas moved up or down and the readiness %.
- **Recall masters, recognition doesn't:**
  - Choosing the right answer or flipping a card can lift an idea to Familiar at most.
  - Only typing it ("Type it", for short answers) or explaining it ("Written", AI-checked) masters it. If the student picked only Choice, a correct choice at Familiar masters the idea so they're never stuck.
- **Confidence:** with "Ask how sure I am" on (the default, with an explanation of why it helps), each choice is followed by **Sure / Think so / Guess**.
  - A right answer marked Guess doesn't count.
  - A new idea answered right and Sure skips straight to Familiar.
  - A wrong answer marked Sure is flagged and comes first next round.
- **The repeat of a miss** a few seconds later only confirms Learning; it can't jump to Familiar.
- **Ways to learn** (tiles, remembered per browser, at least one always on):
  - Choice (pick from four)
  - Type it (short answers, checked on the spot with typo tolerance)
  - Written (explain it, AI checks it)
  - Flashcards (flip it and say honestly whether you knew it)

  New ideas use the first recognition format picked; Familiar ideas use the first recall format that fits the answer's length.
- **Test date:** shows a readiness % (Mastered counts fully, Familiar half, Learning a little), days left, and how many ideas to master per day so everything is mastered the day before.
- **Fading:** a mastered idea not practised for 5 days counts as Familiar again and comes back for a quick recall check.
- **Explanations on demand:** after a miss the student sees the right answer and the buttons **Ask why** (opens the Tutor with the question), **Explain** (shows "Why it's right / Why yours isn't" inline) and **Next**. The explanation is no longer shown automatically.
- **When AI checks run out,** a written question becomes a self-check: show the answer, then "I got it" / "I missed it".
- **Final check:** once everything is mastered, a link to the Quiz.
- **Saved:** progress is saved to the account (`flashcard_progress.learn`) with a copy in the browser. Misses also feed Study now.

### 5.2 Flashcards (spaced review)

- Flip with a tap or Space. Mark **Again** / **Got it** with buttons, keys 1/2, or a swipe. Also Shuffle, Star, Edit and Ask.
- **Leitner spaced review:** intervals of 1, 2, 4, 7, 15 and 30 days. Got it moves a card up one box; a miss sends it back to box 0, due tomorrow.
- The finish screen shows Still learning vs Know.

### 5.3 Quiz (the "Retain" engine) and Match

- **Question types:** Choice, Written (AI-graded Right / Partly right / Not quite), Fill in, and Pairs (drag or tap to match). Fill in and Pairs are Pro, with limited free tries.
- **Retain logic:**
  - Each idea is asked once.
  - A miss must then be answered right 2 more times, about 3 questions apart, in a different format.
  - Only first tries count toward the score.
  - First-try misses feed Study now, with confident misses first.
- **Confidence prompt:** Sure / Think so / Guess on first asks.
- **Match:** pair questions to answers in 60 seconds, with a ring timer that turns amber, then red.
- **Finish screen:** accuracy ring, confetti at 100%, and a past scores list. "Regenerate" makes new questions.
- **Check yourself** (`/quiz/{id}?check=1`): 5 spread-out questions when a guide is new.

### 5.4 Practice (problem solving)

- About 10 AI-generated problems in the subject area of the guide or of an uploaded file. Numeric answers are recomputed to verify them. Coding problems include starter code and tests.
- **Drawing board:**
  - Draw / Erase / Type tools, 8 pen colours, a size slider, undo, clear, and save as PNG.
  - Symbol keys: + − × ÷ = √ π Σ →, xⁿ.
  - **Tidy** (AI turns handwriting into typed text).
- **Check answer** (AI grades), **Ask** (Tutor), **Report** a wrong grade, Reveal the answer with Why.
- A Source panel you can reveal or hide.

### 5.5 NCLEX (nursing, Pro)

- Multiple Choice and Select All That Apply, each with a rationale.
- A practice score, retakes, and **Save as Study Guide**.

### 5.6 Study now / Daily review

A mixed queue in this order: flashcards that are due, then quiz misses (confident ones first), then open practice problems. It shows "All caught up" when there's nothing left.

### 5.7 Coming October 2026 (work in progress)

- Quiz folds into Learn as "Test yourself": Quiz, Timed test and Match.
- A **timed practice test** (mock exam with a countdown and results at the end).
- Learn generates the study set automatically for notes-only guides.
- Exam alert → Learn in one tap, with the test date filled in.
- An exam countdown card on the Dashboard.

---

## 6. Progress, motivation and analytics for students

- **Streaks:** a streak flame on the Dashboard that grows at 7 and 30 days. One automatic **freeze** per week, shown as a snowflake.
- **Progress page:**
  - Tiles: Streak, Last 7 days, Cards reviewed, Quiz average.
  - Charts, each with an accessible data table: Study time (30 days), How you study, By class, Quiz scores, When you study.
  - A **Year heatmap**: tap a day to see what was studied.
  - **Knowledge map:** a rotating 3D sphere of cards coloured Not studied / Learning / Known / Mastered, with a by-guide list.
  - **Insights:** strengths and weak spots, plus **Practice these**.
  - **Recap card:** "Semester in Cordia" (hours, cards, top class), shareable as a PNG.
- **Session finish screens:** accuracy ring and confetti, plus an occasional "Enjoying Cordia?" rating prompt.

---

## 7. Staying on track: Dashboard, Calendar, Week, Canvas

- **Dashboard:**
  - **Continue** (the last guide, with a progress ring).
  - **Class updates** (alerts):
    - grade dropped, missing work, date change, new work
    - exam in N days, with **Build review**
    - module finished, with **Make review set**
    - draft stalled or repo quiet, with **Get unstuck**
    - date change found in an email or announcement, with **Update** / **Remove it**
  - **Course work:** Upcoming / Missing / Completed tabs with count badges and date blocks. Missing items show "N days late". Check items off, open the assignment sheet, and jump to Plan your week or See calendar.
  - A Progress strip, a "Connect your apps" setup card, and Learn Cordia during the first week.
- **Assignment sheet:**
  - **Break it down** into steps with their own due dates.
  - **Schedule study time** / **Find more time**.
  - The rubric, with **Ask Tutor** (rubric loaded).
  - **Link a Google Doc** → **Get feedback on it**.
  - **Link a GitHub repo** → a commit chart and **Ask Tutor about my code**.
  - For exams: **Build review set**.
- **Calendar:**
  - A week view (Previous / Next / This week).
  - Shows Canvas deadlines, lecture to-dos and study blocks (Study / Review).
  - Connect Canvas with a token, or use a calendar link (.ics) if the school blocks tokens. Illustrated instructions show where to click in Canvas.
  - Optional desktop notifications.
- **Plan my week** (`/week`):
  - Pick what's due in the next 7 days; Cordia breaks each pick into steps and fits study time into free time.
  - Also shows study time and grades, and an announcements digest tagged Date change / New work.
- **Canvas page:** Sync now, classes, course files (find, **Make guide**, download), and choose classes.
- **Grades:** a current grade ring per class, plus what each upcoming assignment needs to keep or reach a letter grade.

---

## 8. The Tutor

- An AI tutor that answers **from the student's own material**.
  - **Context picker:** Guides / Notes / Files / the browser page, or general chat with no material.
  - Lives in a resizable side drawer. On phones, and at `/tutor`, it's a full page; `?assignment=` loads a rubric and `?ask=` prefills a question.
- **Quick chips:** Explain, Make guide, Practice, Flashcards, Edit outline. You can attach up to 5 files, ask by voice, and have replies read aloud. Replies can include Mermaid diagrams and Napkin visuals.
- **Skills:** explain, capture (browser page), build_guide, practice, retain (why was I wrong), plan, find_material, organize (file things into classes), edit_outline. It can also open places in the app and rename guides.
- **Modes** (Settings › Tutor): Auto, Explain, Practice, Retain, Plan.
- **Learning style:** Visual, Listening & talking, Reading & writing, Hands-on, or A mix. This shapes Tutor replies and the first Explain view.
- **Past chats:** per guide and general, with new chat and resume. Session state is shared between the web app and the extension.

---

## 9. The Chrome extension

- **Basics:** Manifest V3, version 2.1.3, in the Chrome Web Store. It's a **side panel** opened by the toolbar icon, **Ctrl/⌘+Shift+Y**, or right-click **Make study guide from selection**.
- **Sign-in sync:** a bridge script on the Classroom site mirrors the sign-in into the extension ("Connected as …"). It also lets the web app ask the extension to read a **Quizlet set** or a **YouTube transcript** using the student's own session.
- **Flow:** **Make study guide** → Capture → Read → Focus → Create → **Save to Classroom** (opens the guide). Auto-save is coming.
- **What it reads, in priority order:**
  1. The selected text.
  2. An embedded document: PDF, PPTX, DOCX or images. Google Docs, Slides and Sheets are exported as PDF; Canvas `/files` links are rewritten to the download URL.
  3. The page's main text, using selectors for Canvas, Moodle, Blackboard and D2L, plus Readability.
  4. A linked document.
  5. A screenshot.
- **Tutor in the panel:** "Ask about this page", New chat, Full screen.
- **Locked area:** the Canvas slideshow capture code may not be changed without explicit permission from the owner.

---

## 10. Classes and sharing

- **Classes:** have a name, school and course code ("MGT 300"). A class can have a designed cover (colour plus up to 3 icons, or Pick for me), and a grid or list view. Its page has the tabs Your material, Course files and Grades (Canvas classes), Class sets, and Deadlines.
- **Sharing:**
  - The first guide filed into a class asks "Share with {code}?". Sharing is anonymous by default and the prompt links to the Honor Code.
  - **Class sets** are classmates' shared guides, with versions, "Studied by N", **Save** a copy and **Report** (wrong, copied exam, copyright, inappropriate).
  - Shares can be "Held for review".
  - Instructors can verify their school email and **turn off sharing** for a course code.
  - A public copyright takedown form hides a reported set immediately, pending review.
- **Moderation:** admin queue, merges and takedowns (staff only).

---

## 11. Integrations (connectors)

| Connector | What it does |
|---|---|
| **Canvas** (token, encrypted) | Classes, assignments, grades, announcements (AI reads them for date changes and new work), exams, course files, auto-import of modules. Background sync every ~20 min. |
| **Canvas calendar feed** (.ics) | Fallback when the school blocks tokens: deadlines only. |
| **Google Calendar** | Study blocks go on a separate "Cordia" calendar. Moving or deleting them is kept in sync. |
| **Apple Calendar** | Subscribe to deadlines (.ics feed). |
| **Google Tasks** | A "Cordia" list with assignment steps as subtasks; done syncs both ways. |
| **Google Drive / Dropbox** | Link class folders (new files arrive every 30 min), import, Save to Drive. |
| **Google Docs** | Import, export guides, feedback on drafts for assignments. |
| **Notion** | Import; a course database ("Cordia assignments") synced both ways; export with questions as toggles. |
| **Google Sheets** | Export grades and study time, optionally daily. *(Being hidden behind a flag.)* |
| **Gmail / Outlook** | Watch for date changes in professors' emails. |
| **Slack** | Watch class channels; post study sessions. *(Being hidden behind a flag.)* |
| **GitHub** | Repo activity for programming assignments. *(Being hidden behind a flag.)* |
| **YNAB** | Assistant only (budget by text). |

Most connectors run through **Composio**, one project shared with the Assistant. Each connector's sheet has a **Try it** button. Connectors can be enabled per use: for the Tutor, the Assistant, or both.

---

## 12. The Cordia Assistant (texting companion)

- **What it is:** a separate app (Next.js, mounted at `/assistant`, its own Vercel project and repo) that texts students by SMS through Twilio. Its settings live inside Classroom at `/assistant`.
- **Setup:** verify a US mobile number with a code, confirm age 18+ and consents, then a personality survey (Mini-IPIP, with an adaptive IPIP-50 second stage).
- **Personality:**
  - 19 voice presets (friend, coach, stoic, pirate, chaplain…), with mature ones opt-in.
  - Custom personas and up to 500 characters of custom instructions.
  - Quiet hours are at least 21:00–08:00.
- **What it does:**
  - Reminders (create, list, cancel).
  - Calendar (list and create events, now without Google Meet links).
  - Email triage (recent messages).
  - Canvas deadlines (from Classroom's Canvas data), mark done, and memory (it remembers facts about you).
- **Proactive texts:** morning plan, evening wrap-up, goal check-ins, heads-up before events, streak saves. Exam texts linking into Learn are coming.
- **Safety:**
  - STOP, START, HELP, PAUSE, RESUME, LESS and DELETE are handled without AI.
  - A crisis screen sends the 988 message and pauses check-ins for 48 hours.
  - Unknown numbers get one "sign up in Classroom" reply a day.
- **Limits:** Pro and trial users text without limit; free users get a few replies a day (default 3).
- **Behind the scenes:**
  - Tables live in the `assistant` schema of the same Supabase project.
  - Cron jobs: a 1-minute send tick, and a nightly 07:00 UTC planner.
  - Memory uses pgvector.
  - A daily LLM budget switches replies to the fast model when it's exceeded.

---

## 13. AI: models, pipeline and rules

**Provider:** Anthropic Claude whenever `ANTHROPIC_API_KEY` is set (production).
- **Sonnet** (`claude-sonnet-5-5`, effort medium) handles guides, questions, outlines, practice sets and vision.
- **Haiku** (`claude-haiku-5-5`, effort low) handles the Tutor, grading, wrong-answer options, titles, announcement reading and other small jobs.
- **Opus is never used:** overrides that name it are ignored.
- **Fallbacks** if the Anthropic key is missing: Groq (`openai/gpt-oss-120b`, `qwen` for vision), then OpenAI (GPT-4o / mini).
- **Lecture transcription** stays on Whisper (`whisper-large-v3-turbo` on Groq, otherwise OpenAI).
- **Visuals** come from Napkin AI.
- Every model call is logged to `usage_events` (feature, model, tokens).

**How a guide is generated:**
1. **Capture / extract:** the extension scrapes the page, or the server extracts file text (python-pptx for PPTX, PDF text, vision for scanned pages and images).
2. **Pre-process** (`text_processing.py`): detect and format slideshows, strip navigation and noise, chunk into about 1,500 characters (one per slide, quotes kept whole), and inject image descriptions. Content-quality problems are fixed here first. Prompts are only the backup filter.
3. **Generate:** batches of about 8,000 characters, each sent to the model with the study-guide prompt:
   - Step 1, inventory every testable item. Step 2, write the questions.
   - Split trivial details into separate questions, include higher-order why/how questions, skip references, make every question stand alone, keep quotes verbatim.
   - Return `NO_EDUCATIONAL_CONTENT` when the input isn't educational.
4. **Post-process:** normalise and renumber the Q/A, trim answers, derive flashcards, AI-name weak titles, and generate the outline (when it's first needed).
5. **Quiz:** wrong-answer options are written by AI (Haiku), checked for balanced length, and cached on the guide.

**Prompt-writing rules for anyone working on Cordia:**
- Keep wording domain-neutral, using terms like "definition, role, contribution, context, relationship".
- Never add a rule that restates an existing rule.
- Fix content problems in pre-processing before touching prompts.
- Test wording mentally against nursing, art history, business law, literature and CS.

**Feature limits** (max output tokens): study_guide 12,000; practice_set 9,000; NCLEX and exam questions 16,000; tutor replies 200–1,400 depending on mode; grading 250–300; titles 60.

---

## 14. Architecture

| Layer | Technology | Where |
|---|---|---|
| Web app | Next.js 16 (Pages Router, React 19), styled-jsx, Vercel Analytics | Vercel; deploys automatically on push to `main` |
| Backend API | FastAPI (Python 3.11), uvicorn single worker, LibreOffice for PPTX rendering | Fly.io app `autostudy-ai` (iad, 1 shared CPU, 1 GB); deployed manually with `cd backend && fly deploy` |
| Database / auth / files | Supabase (Postgres, Auth with JWT, Storage) | One project shared with the Assistant |
| Extension | Chrome MV3 side panel | Chrome Web Store |
| Assistant | Next.js 15 App Router, Twilio, Composio, pgvector | Vercel (separate project); Classroom proxies `/assistant` to it |
| Payments | Stripe Checkout, Portal and webhooks | |
| AI | Anthropic (Sonnet, Haiku), Whisper (Groq/OpenAI), Napkin | |

**Backend routers (25):**
- materials (extract / ingest / generate)
- guides, folders, quiz (Retain), practice, nclex
- chat and tutor, learning (styles, study aids, onboarding), smart_notes
- canvas, calendar, plans (assignment plans, review sets, deadline changes, alerts, week), connectors, apps, drive, workspace (Docs / Notion)
- classes (classes and sharing), stats, search
- billing, feedback, admin, public_forms (instructor opt-out, copyright), auth

**Background sync worker:** runs inside the API process, ticking every 60 seconds (moving to 5 minutes):
- Canvas every 20 minutes; Google Tasks and Calendar every 15 minutes.
- Drive, mail watch, Notion, Dropbox and Slack every 30 minutes; Docs and GitHub every 6 hours; Sheets daily.

**Web-side AI routes** (`web/pages/api`): lectures (chunked audio upload, transcription, notes, analysis), guide-notes (outline), visual (Napkin), notes, cover-icons, card images, CSP reports and client errors.

**Testing:**
- Python unit tests (`python -m unittest discover -s tests`).
- Node tests (`node --test`), including Playwright extension-capture tests.
- `next build`.
- A QA mock API (`tests/qa/mock-api.cjs`) for local Playwright checks.
- CI (`release-checks.yml`) runs pyflakes, unit tests, node tests and the build on every PR.

**Operations:**
- Debug the backend with `cd backend && fly logs`. Backend changes need `fly deploy` before they're live.
- The web app goes live when a PR is merged to `main`.
- Secrets live in Fly (`fly secrets set`) and in Vercel environment variables.
- **Lesson from October 2026:** a key pasted with extra characters broke all AI calls. Check a secret's length with `fly ssh console -C 'sh -c "printenv KEY | wc -c"'`.

---

## 15. Data model (Supabase)

**Core tables:**
- `study_guides`: holds the guide fields described in section 4 (title, outline notes, `Q1:`/`A1:` text, flashcards, cached quiz questions, practice state, source info, sharing links).
  - `flashcard_progress` JSON has this shape: `{known, unknown, last_studied, schedule: {idx: {box 0–5, due}}, learn: {levels: {idx: {l 0–3, at, q (question fingerprint), sure?}}, test_date}}`.
- `folders` (classes; with class_id and a designed cover), `quiz_attempts`, `study_sessions` (type, duration, metadata), `user_streaks`, `user_profiles`.

**Learning:** `learning_preferences` (learning style), `study_aids`, `onboarding_progress`, `tutor_sessions`, `tutor_chats`.

**Canvas:**
- `canvas_tokens`: AES-256-GCM ciphertext, IV, last 4 characters, expiry.
- `canvas_connections`, `canvas_courses`, `canvas_assignments`, `canvas_activity` (audit log), `canvas_school_policy`, `canvas_calendar_connections`.
- `canvas_announcements`: summary plus a change type (none / deadline / new_work).

**Planning:** `assignment_plans`, `assignment_steps`, `study_blocks` (work/review), `deadline_marks`, `deadline_changes`, `connector_settings`, `connector_links`.

**Classes and sharing:** `schools`, `classes`, `class_terms`, `class_memberships`, `class_merge_proposals`, `sharing_settings`, `class_share_defaults`, `shared_sets`, `shared_set_studiers`, `shared_set_reports`, `instructor_blocks`, `copyright_takedowns`, `app_admins`.

**Media:** `visual_cache`, `note_covers`, `guide_visuals`, `lectures`, `lecture_todos`.

**Billing:** `user_subscriptions`, `usage_ledger`, `usage_events`, `monthly_usage` (legacy). RPCs `record_feature_usage` and `feature_usage_counts`.

**Feedback:** `feedback` (with attachments).

**Storage buckets:** `lecture-audio` (private), `visuals` (public SVG), `card-images` (public), `feedback-attachments` (private).

**Security model:** row-level security is on. Writes go through the FastAPI backend with the service role; a few tables allow students to read their own rows.

**Migration discipline:** new migrations are written, then held until the owner approves. Several are marked "NOT APPLIED: waiting for owner's OK", so the live schema can differ from the repo.

---

## 16. Plans, pricing and limits

- **Free plan:** 3 study guides a month (app and extension combined), 10 Tutor prompts, 5 Explain views, and one free try of each Pro tool.
- **Pro:** **$9.99/month** or **$29 per semester** (4 months, "Save $10.96"), with a **7-day free trial and no card**. It's advertised as "unlimited", but has generous caps.
- **Monthly limits** (reset on the 1st, UTC):

| Feature | Free | Pro |
|---|---|---|
| Study guides | 3 | 100 |
| Tutor prompts | 10 | 1,000 |
| Explain ("learn my way") views | 5 | 300 |
| Practice sets | 1 | 100 |
| AI quizzes | 1 | 200 |
| NCLEX | 1 | 50 |
| Quiz Fill in / Pairs ("retain types") | 1 | 300 |
| Light AI actions (grading, why, vision transcription…) | 30 | 500 |
| Lecture minutes | 120 | 1,500 |
| Visuals | 10 | 200 |

- **Enforcement:**
  - `require()` runs before an AI call and returns 402 `limit_reached` with an upgrade link, which opens the upgrade modal. `record()` runs after success.
  - `UNLIMITED_USER_IDS` bypasses all limits (the owner and testers).
  - A legacy lifetime cap of 5 free guides is still live in the database until its removal migration is applied.
- **The Assistant:** Pro is unlimited; free users get a daily text cap.

---

## 17. Security, privacy and integrity

- **Canvas tokens:**
  - Encrypted with AES-256-GCM, with the user ID as associated data.
  - Requests are read-only (GET), to an allowlist of endpoints.
  - SSRF protection: only `*.instructure.com` or hosts in the school policy, public IPs only.
  - Every call is logged; tokens are scrubbed from logs.
- **Signed tokens:** written-answer grades are HMAC-signed, so scores can't be faked. Calendar feeds and visual tickets are signed too.
- **Rate limits** per IP and per user. Request bodies are capped at 60 MB (uploads) and 8 MB (JSON).
- **Security headers:** strict CSP (enforced, with a report URI), HSTS preload, frame-deny, and a Permissions-Policy that allows the camera and mic only on the site itself.
- **Account deletion:** type DELETE to confirm. This cancels Stripe, deletes data and files, then deletes the auth user. The Assistant has its own export and delete.
- **Honor Code:** Cordia is a study aid. Students may not submit AI content as their own, use it during live exams, or get around LMS integrity features. Instructor opt-out and copyright takedown are public.

---

## 18. Design language

- **Look:** "Liquid glass, matte": glass panels over a soft cloudy backdrop, with ivory reading surfaces.
- **Colour:** an olive palette (primary `#536149`). Colours are defined only as tokens in `tokens.css`; a test forbids raw colour values elsewhere.
- **Fonts:** **Newsreader** for display headings and **Quicksand** for UI text.
- **Themes:** light and dark, saved on the account. Public pages stay light.
- **Loading:** the breathing Cordia mark is the only loading indicator. Pages appear whole: no half-loaded screens and no skeletons.
- **Accessibility:**
  - A skip link, ARIA tabs with arrow keys, and a data table behind every chart.
  - Reduced motion is respected.
  - Keyboard alternatives for drag and resize.
  - A keyboard shortcut sheet opens with "?".
- **Phones:** a top bar plus a bottom tab bar (Dashboard, Library, **New**, Calendar, Assistant). Swipe cards, tap-to-match, no sideways scrolling.
- **Focus mode:** the study screens (Learn, Flashcards, Quiz, NCLEX, Practice, Study now) hide the navigation.

---

## 19. Onboarding and help

- **Day-one walkthrough:**
  1. New → pick a source.
  2. "About you" (level, school, major) while the guide builds.
  3. Try 3 questions.
  4. "Your first review is tomorrow", with a nudge to get the extension.
- **One-time tips:** Ask why, add deadlines, weak spots, highlight to explain, flashcard keys, typing shortcuts.
- **Learn Cordia:** every feature has a **Show me** walkthrough, in four groups: Make study material, Study, Stay on track, Your apps. Items tick off as the student actually uses them.
- **Help sheet:** replay the tour, feedback, shortcuts, extension link, policies.
- **Feedback dialog** ("Beta feedback"): categories plus pasted or attached screenshots, with a staff review page.

---

## 20. Current state: metrics (October 2026)

From production data, last 30 days unless noted:
- **Users:** 77 accounts in total. 37 signed up in the last 30 days, 49 were active in the last 30 days, 8 in the last 7.
- **Drop-off:**
  - 37 accounts have never made a guide; 17 made exactly one.
  - 37 users were active on only 1 day, 19 on 2–3 days, 15 on 4 or more.
- **Guides:**
  - 268 in total, 195 created in the last 30 days.
  - By source: Canvas modules 123, file 55, webpage 15, pasted text 7, others small.
  - **All 123 Canvas imports have notes but no questions**, so they need a study set before they can be studied. This is being fixed.
- **Study activity:**
  - Reading 716 sessions, browsing 2,011 sessions.
  - Quiz 19 sessions, flashcards 10 sessions; 13 quiz attempts with an average score of 92%.
  - Study modes are barely used compared with reading.
- **Time tracking is inflated:** some sessions are recorded as 24 hours, from idle open tabs. This is being fixed.
- **AI usage:** most guides before October 27 were made on GPT-4o; Claude is now the provider.

---

## 21. Known problems and the active overhaul (in progress October 29, 2026)

An audit found these issues. Five work streams are fixing them now.

**A. Speed**
- Run the guide's AI calls (notes and batches) in parallel instead of in series.
- Skip the screenshot vision call when the page text was read fine.
- Auto-save in the extension.
- Pre-build the quiz's wrong-answer options right after a guide is saved, so the first Learn is instant.
- Canvas "Sync now" runs in the background.
- The sync worker makes one query per tick, every 5 minutes, and stops making a query per item.
- Lighter page loads: send only the fields needed, and stop repeat fetches.
- Canvas file → guide happens on the server (no download and re-upload).

**B. Getting students studying**
- Canvas and notes-only guides get their study set automatically when opened.
- A first guide for new students: from their Canvas class, or a sample, landing in Learn.
- Exam alert → Learn in one tap, with the test date filled in, plus an exam countdown card.
- Learn and Cards buttons on Continue.
- Quiz folds into Learn's "Test yourself", with Quiz, Timed test and Match.
- The new timed practice test.

**C. Honest progress**
- Fix a bug where a Learn round without misses erased the misses Quiz had saved.
- Count only active study time: idle detection, plus a cap on the server.
- One progress picture: the knowledge map and Study now read Learn levels too.

**D. Cleanup**
- One upload path (the New sheet).
- New note makes a guide directly.
- Remove dead pages, routes, files and code.
- Merge Settings sections (Study into Tutor, Appearance into Account; remove the duplicate Learn Cordia).
- Hide the Sheets, GitHub, Slack and Dropbox connectors behind a flag.

**E. Assistant**
- Exam texts: "BIO exam Thursday: 6 ideas left to master. About 10 minutes today:" plus a link into Learn.
- Respects quiet hours and opt-outs.

**Deliberately kept:** the OpenAI/Groq fallback code, as a backup if the Anthropic key fails again.

---

## 22. The adaptive learning engine (planned): "Cordia learns how you learn"

**Goal:** a background system that learns, for each student, *what makes things stick for them*. It then adjusts their experience automatically: which question formats, which explanation views, when to review, how long sessions run and how hard to push. It should explain itself, and the student can always override it.

### 22.1 What it observes (signals Cordia already has or can easily log)

| Signal | Source | What it tells us |
|---|---|---|
| Correctness by **format** (choice, type it, written, flashcard, fill, pairs, practice) | Learn, Quiz, Flashcards, Practice | Which formats build real recall for this student, not just which they're good at |
| **Delayed recall:** does an idea answered right today hold up 1, 3 and 7 days later? | Learn fading checks, Leitner reviews | The true learning outcome; the most important signal |
| **Confidence calibration:** Sure / Think so / Guess vs actual correctness | Confidence prompt | Overconfidence (sure and wrong) vs underconfidence; how much to trust self-ratings and flashcard self-checks |
| **Response time** per question (first keypress, submit) | Study screens | Fluency; hesitation that a right answer hides |
| **Explanation effectiveness:** which view (Diagram, Listen, Notes, Real life, Tutor "Ask why", visuals) came before a later correct recall | Explain / StudyAidPanel / Tutor logs | Which explanation style actually works for this person (revealed preference), vs the learning style they picked (stated preference) |
| **Session shape:** length, time of day, day of week, where they stop | study_sessions (made accurate by stream C) | Best study length, best time, signs of fatigue (accuracy dropping late in a session) |
| **Subject differences** | Class or guide domain | Formats that work for vocabulary-heavy classes vs problem-solving classes |
| **Engagement:** which modes they open and finish, skips, streaks | Events | Keep them coming back without over-pushing |

### 22.2 How it models the student

1. **Item memory (per idea, per student):** a modern spaced-repetition model such as FSRS (stability, difficulty, retrievability). It replaces both the fixed Leitner intervals and Learn's fixed 5-day fade.
   - Each review updates the idea's predicted chance of recall today.
   - Review is scheduled for the moment that chance drops to a target, for example 90%. When a test date is set, the target ramps up as the test approaches.
   - This unifies Flashcards, Learn and Study now under one memory record per idea.
2. **Learner profile (per student):** a small set of estimates, each with uncertainty:
   - recall gain per format
   - explanation-view effectiveness
   - calibration offset
   - best session length and best time of day
   - a fatigue curve
   - per-subject adjustments

   Each estimate is updated after every session with Bayesian updates (Beta distributions for success rates, with recent sessions weighted more). It starts from population averages and the learning style the student picked (cold start), then shifts toward observed behaviour.
3. **Decision policy:** a contextual bandit (Thompson sampling) chooses among safe options:
   - which format to ask next
   - which Explain view to show first
   - round size (5–10)
   - session length suggestion
   - when to send an Assistant nudge

   The reward is **delayed recall success**, not instant correctness, so the system never learns to just ask easy questions.

### 22.3 What the student experiences

- **Ways to learn are pre-set:** Learn picks the mix that works for this student, and a note says why: "You remember more when you type answers, so we lead with Type it."
- **Explain opens the right view first:** for example, Diagram for someone whose recalls improve after diagrams.
- **Review times adapt:** Study now and the Assistant's texts come when this student's memory is about to fade, at their best time of day.
- **Calibration coaching:** "You're often sure and wrong on dates; we'll double-check those."
- **Session pacing:** rounds shorten when fatigue shows; a "good place to stop" appears at the student's sweet spot.
- **Transparency:** a "How Cordia adapts to you" panel in Settings shows the profile in plain words, with a reset and an off switch.
- **Guardrails:**
  - The student's explicit choices always win.
  - Exploration stays at around 10% or less of decisions.
  - It never hides a format the student turned on.
  - It never makes the mastery bar easier: recall is still required to master an idea.

### 22.4 Data and implementation plan

- **Storage** (needs owner-approved migrations):
  - `learning_events`: append-only; user, item (guide plus question fingerprint), format, correct, confidence, latency, view shown, timestamp.
  - `item_memory`: user, item, stability, difficulty, last review, next due.
  - `learner_profile`: user, JSON of estimates with counts, updated time.
- **Compute:** update item memory on every answer (cheap, server-side). Recompute the profile nightly in the sync worker, or incrementally after each session. No LLM is needed for the core algorithm. Claude is used only to phrase the "why" notes.

**Phases:**
1. **Log learning events** from Learn, Quiz, Flashcards and Practice, and fix time tracking (stream C).
2. **FSRS item memory** replaces Leitner and the fixed fade; one record per idea.
3. **Learner profile** plus the "How Cordia adapts to you" panel, with read-only insights.
4. **Adaptive defaults:** format mix, first Explain view, round size and review timing, with the bandit and guardrails.
5. **Assistant timing:** texts at the predicted forgetting moment and the student's best time.

**How we'll know it works:**
- Retention at 7 days and accuracy on final checks, compared against a control group with fixed defaults (an A/B test).
- Fewer drop-offs after day 1.
- Better calibration over time.

**Privacy:**
- The profile is the student's own data. It's included in export and deletion, and never shared.
- Signals are study behaviour only, never content from email or calendars.

---

## 23. Working rules for this project (for anyone, human or AI, building Cordia)

- **Preview only:**
  - Never push to `main`, never promote to production on Vercel, never run database migrations.
  - Migrations are written and then shown to the owner.
  - Opening PRs is fine; the owner merges.
- **Backend changes** are live only after the owner runs `cd ~/cordia-classroom && git checkout main && git pull && cd backend && fly deploy`. Check `fly logs` afterwards. Never claim a backend fix is live before that.
- **Secrets:**
  - Never expose `SUPABASE_SERVICE_ROLE_KEY` or Napkin keys to the browser.
  - Never commit keys.
  - Production database writes are given to the owner as SQL.
- **AI models:** Claude Sonnet and Haiku only. Never Opus.
- **Pipeline discipline:**
  - Trace extension → backend → frontend before changing a data format.
  - Fix problems at the earliest point in the pipeline.
  - Read a file before editing it.
- **Locked:** the Canvas slideshow capture in the extension may not be changed without explicit permission.
- **Style:**
  - Domain-neutral prompts.
  - Use colour tokens only, never raw colours.
  - Match the surrounding code.
  - Keep answers to the owner short and plain.

---

## 24. Glossary

- **Guide / study guide:** one piece of material turned into an outline plus Q/A and flashcards.
- **Outline:** the notes view of a guide.
- **By page:** the questions grouped per page or slide.
- **Learn:** the mastery-ladder study mode.
- **Retain:** the engine behind Quiz (misses repeat, first tries count).
- **Study now / Daily review:** a mixed review of due cards, misses and open practice.
- **Check yourself:** five questions when a guide is new.
- **Review set:** a guide built for an upcoming exam from a class's material.
- **Class / folder:** a course container (`folders` table), optionally linked to Canvas and a shared class.
- **Class sets:** classmates' shared guides for the same course code.
- **Course work:** Canvas assignments (Upcoming / Missing / Completed).
- **Study block:** scheduled study time (work or review) on the calendar.
- **Fading:** a mastered Learn idea not practised for 5 days.
- **Readiness:** the Learn score of how prepared a student is for a test.
- **Pro / classroom_plus:** the paid plan.
- **Light / build / vision:** the AI cost tiers (Haiku / Sonnet / Sonnet-vision).
- **Cordia Assistant:** the SMS companion app.
- **Connectors:** integrations with other apps (Composio-backed).
