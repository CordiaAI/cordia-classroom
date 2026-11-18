# Tutor as command center (CC1 to CC4)

From the cofounder via Jude, 2026-11-18. Queued after F6b, in this order. Opus for the Tutor logic and UI, Sonnet for data plumbing. Each phase is its own pull request with a preview link and a review (draft until the review passes). Lean rules apply.

Constraints carried from CLAUDE.md and earlier decisions: the Tutor's models stay as they are (Haiku for the Tutor and small jobs, Sonnet for guides; never Opus at runtime); prompt rules domain-neutral and minimal; every tool call scoped to the caller's own rows; 4xx never 500; the Chrome extension's `/chat` contract unchanged; anything that creates something or costs a generation is announced, never silent (F6b).

## CC1 Actions and choice cards (builds on F6b's tool use)
- Tools to open and start things: open_learn, open_flashcards, open_quiz, open_practice (each with an optional guide and topic), open_calendar, open_guide, and start_review_set for an upcoming exam. Claude's native tool use through the existing Anthropic client. No LangChain.
- "I want to practice for my discrete math exam" finds the matching guide or exam and opens Practice on it, announced in one line. If several match or the ask is vague ("help me study for math"), show three pick-one cards in the chat (title, class, exam date or readiness, Start button) instead of guessing.
- Before any tool that creates something or costs a generation, a fast Claude Haiku check confirms it matches what the student asked; if not, the Tutor asks instead. Logged to usage_events.

## CC2 Knows the student
- A server-side "student snapshot" (about 300 words max): exams in the next 14 days with readiness, deadlines in the next 7 days, the 5 weakest ideas, recent study sessions, and learning style. Cached and refreshed when the data changes; included in the Tutor's system prompt with prompt caching so it stays fast.
- Read-only lookup tools: list_guides, get_guide_summary, get_quiz_results, get_weak_ideas, get_schedule. The Tutor uses the snapshot first and tools only when it needs more.
- Every answer that recommends what to study names where that came from ("from your MA 125 Exam 3 readiness").

## CC3 Memory of struggles
- Log a learning event for every answer in Learn, Quiz, Flashcards and Practice (idea, format, correct, confidence, time), as phase 1 of the adaptive engine in the cofounder's brief. Migration written and marked NOT APPLIED for Jude.
- Weak ideas and recent misses feed the snapshot.
- When a student says an explanation helped ("oh that makes sense"), the Tutor may save a short note of which explanation style worked for that topic, shown and removable under "What Cordia remembers". Never health, contact or other private details.

## CC4 Style, visuals and tone
- Math rendered properly in the Tutor (KaTeX, inline and block: x², fractions, roots, sums, Greek letters), in chat and in voice captions.
- Rich in-chat cards: a mini quiz (3 questions, answered inline), a guide card, a session-start card and a diagram card, plus opening bigger views in the T6 tool pane.
- System prompt rules from the student's learning style: visual learners get a diagram (Napkin or Mermaid) when the idea has structure; listening learners get shorter spoken-style answers; and so on.
- Tone: friendly and plain, the high-level idea before the details, a metaphor only when it genuinely clarifies, no slang openers.

## Speed targets
First words of an answer within about 1.5 seconds; read-only tool calls under 300 ms each.

## Director's notes
- The "adaptive engine brief" is not in this repo; CC3's builder needs it (ask Jude for the file when CC3 starts) or works from the bullet above.
- CC4's "open bigger views in the T6 tool pane" depends on T6, which is later in the queue; until T6 lands, bigger views open full screen.
- Queue after this set: F4, F2+F7, F8, F3, then T7, T6, T8, T9, T11 (unless Jude reorders).
