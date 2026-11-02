# Cordia for Claude (MCP): setup

The MCP server is `https://classroom.cordiacode.com/mcp`. Supabase Auth's OAuth 2.1 server signs
students in; the MCP server only checks the tokens it issues.

## How a connection works

1. Claude calls `/mcp` with no token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
2. That document names the authorization server: `https://<project-ref>.supabase.co/auth/v1`.
3. Claude reads Supabase's metadata (`/.well-known/oauth-authorization-server/auth/v1`) and
   registers itself with dynamic client registration. Supabase doesn't support Client ID Metadata
   Documents, so Claude uses registration instead. Each connection attempt registers a new app.
4. Supabase sends the student to `<Site URL>/oauth/consent?authorization_id=…`
   (`web/pages/oauth/consent.js`). The student signs in if needed and approves or cancels.
   Approval is refused unless the app's callback host is on the allow-list (claude.ai, chatgpt.com;
   preview builds also allow localhost).
5. Claude's callback is `https://claude.ai/api/mcp/auth_callback`. It swaps the code for tokens.
6. The access-token hook (`20261031120000_oauth_lockdown.sql`) gives every connected-app token
   role `mcp_client`, audience `https://classroom.cordiacode.com/mcp` and a detached session. App
   APIs, Supabase REST/Storage/GraphQL/Realtime and Supabase Auth's `/user` endpoints all refuse it.
7. On every request `/mcp` checks:
   - the signature against Supabase's JWKS;
   - the issuer, the audience and the expiry;
   - `client_id` and role `mcp_client`;
   - that the grant is still active (`mcp_session_check()`).
   It then builds a Supabase client with the student's own token, so Row Level Security applies.
8. Settings › Connectors › Connected AI apps lists connected apps and has a Disconnect button.
   Disconnect revokes the grant, so the app's next request gets `401`. The card is hidden until an
   app is connected.

A weekly job (`mcp-oauth-client-cleanup`, Sundays 04:23 UTC) deletes self-registered apps that are
older than 30 days and that no student has connected.

## Turning it on (production)

Order matters:
1. Supabase SQL editor: run `supabase/migrations/20261031130000_mcp_connected_apps.sql`.
2. Supabase SQL editor: run `supabase/checks/oauth_lockdown.sql`. It must return **no rows**.
3. Merge the PR so Vercel deploys `/mcp`, the consent page and Settings.
4. Supabase Dashboard → Authentication → **OAuth Server**:
   - Enable the OAuth 2.1 server.
   - Authorization path: `/oauth/consent`.
   - Allow dynamic client registration: **on**.
5. Supabase Dashboard → Authentication → URL Configuration: the Site URL must be the Classroom
   domain the consent page should open on, `https://classroom.cordiacode.com`.

Vercel needs no new environment variables. The optional ones are listed in `web/.env.example`.

## Testing

**Automated.** CI runs these, and they also run locally:
- `node --test web/tests/mcp-auth.test.mjs web/tests/oauth-consent.test.mjs`
- `python -m unittest tests.test_oauth_lockdown`
- `bash tests/oauth/run_local_probe.sh`: a local Supabase stack, the lockdown probe and the `/mcp`
  checks.
- `E2E_WEB=1 bash tests/oauth/run_local_probe.sh`: the above, plus a browser run of the consent
  page, `/mcp` and Settings.

**Claude.ai.** Settings → Connectors → Add custom connector → URL
`https://classroom.cordiacode.com/mcp` → Connect. Sign in to Cordia, choose Allow, and Claude
shows the connector as connected. In Phase 1 the server has no tools yet.

**MCP Inspector.**
1. Run `npx @modelcontextprotocol/inspector`.
2. Choose Streamable HTTP, URL `https://classroom.cordiacode.com/mcp`, then Connect.
3. Inspector's callback is on localhost, which production refuses. When the consent page says
   "can't be approved", change only the host in the address bar to this PR's Vercel preview
   (keep `/oauth/consent?authorization_id=…`). Sign in there if asked, then choose Allow.
4. Inspector shows "Cordia Classroom" connected.

## Phase 2: the read tools

| Tool | What it returns | Logic it shares with the app |
|---|---|---|
| `search_my_materials` | Ranked hits across study sets, flashcards, notes and lectures (lecture hits carry a timestamp) | `search_my_materials()` in Postgres, which the app's ⌘K search also calls |
| `list_study_sets` | The student's study sets, newest first, paged | — |
| `get_study_set` | Notes, outline, key terms; flashcards, quiz and practice on request, paged | `lib/guideText.mjs` (the guide page's parsers), `lib/spacedReview.mjs` |
| `list_lectures` / `get_lecture` | Lectures; outline, "Watch for" quotes with timestamps, to-dos, terms, questions, own notes, paged transcript | the lecture page's analysis |
| `get_due_cards` | What Study now would review, in its order (sure misses, due cards, Learn ideas, other misses) | `lib/studyQueue.mjs` |
| `get_progress` | Streak, active minutes, quiz accuracy, best hours, weakest study sets | the backend's Progress functions via `GET /mcp/progress`, `lib/streak.mjs` |
| `get_job_status` | A background study-set job (created in Phase 3) | — |

All tools are read-only (readOnlyHint true, destructiveHint false, idempotentHint true,
openWorldHint false). Every query runs as the student through their connected-app token, so RLS and
the column grants in `20261101120000_mcp_read_access.sql` decide what each tool can see:
- own rows only;
- never `source_title`, `source_url`, `source_id`, `external_source_id` or `folders.name`;
- never a guide built from a Canvas assignment.

Courses named by Canvas or the calendar feed show as "Course 1", "Course 2"…, each with up to three
of its study set titles.

### Turning it on

1. In the Supabase SQL editor, run `supabase/migrations/20261101120000_mcp_read_access.sql`.
2. Run `supabase/checks/oauth_lockdown.sql`. It must return no rows.
3. Merge the PR so Vercel deploys the tools.
4. Deploy the backend: `cd backend && fly deploy` (for `/mcp/progress` and the folder labels).
   Then watch `fly logs`.
5. Open Cordia once while signed in. This saves the time zone and uploads Retain misses and the
   study log.

Optional backend variable: `SUPABASE_PUBLISHABLE_KEY`. It defaults to `SUPABASE_ANON_KEY`, then to
the project's publishable key. The service-role key is never used for `/mcp/*`.

### Testing

- **Claude.ai.** Open the Cordia connector; it should now list 8 tools. Try "What did my professor
  say about mitochondria?" (search, with lecture timestamps), "Quiz me on what's due" (get_due_cards)
  and "How's my studying going this month?" (get_progress).
- **MCP Inspector.** Connect as in Phase 1. Then Tools → List Tools, and run each one.

## Phase 3: the write tools

| Tool | What it does | Logic it shares with the app |
|---|---|---|
| `record_answer` | Records one answer (flashcard, Learn idea, quiz question, missed question or practice problem) with the student's confidence | Study now's rules: `lib/studyAnswer.mjs` on `lib/spacedReview.mjs`, `lib/learnEngine.mjs`, `lib/retainMisses.mjs`, `lib/studyDays.mjs`; the answer log via the backend's `learning_events.write_batch` |
| `create_study_set` | Queues a study set from pasted text or a public link and returns a `job_id` at once | The backend's `/generate` and `/guides` code (`build_materials`, `create_guide`) and plan limits (`entitlements.require/record`), run by the study-set worker |
| `add_flashcards` | Appends cards to a study set, skipping exact duplicates | — |
| `save_note` | Saves Markdown as a new page in the Library, like New › Note | `lib/outlineDoc.js`'s outline format (`lib/markdownOutline.mjs`) |

Annotations: readOnlyHint false, destructiveHint false, openWorldHint false; idempotentHint true for
`record_answer` (its `idempotency_key` makes a repeat return the first result) and false for the
others. Nothing is deleted or overwritten.

**How writes stay safe.** Every write is a database function (`20261102120000_mcp_write_tools.sql`)
run with the student's connected-app token. Each one takes the student from the token, checks the
study set is theirs and isn't a Canvas assignment guide, and only adds. The token can't update any
table directly.

**One save for the app and Claude.** The flashcard schedule and Learn levels live in one JSON
column per guide. `apply_study_progress()` merges only the cards and ideas just answered, under a
row lock. The app (`merge_study_progress()`, through `lib/progressSave.js`) and `record_answer` both
save through it, so neither overwrites the other's answers.

**Study-set jobs.** `create_study_set` calls `POST /mcp/study-sets`.
1. The route checks the link: only http or https, no LMS link, no private or internal address.
2. It queues the job with the student's token (`queue_study_set_job()`: at most 3 waiting and 10 an
   hour) and checks the plan's monthly study sets.
3. The worker in `services/generation_jobs.py` claims the job, builds the set and saves it labelled
   "Added from <app>".
4. The student sees "<title> is ready (from Claude)" in the app.
5. The app's own New sheet and lecture page now queue their study sets the same way, so a set keeps
   building if the page is closed. Until the backend is deployed, they fall back to the old two
   requests.

The worker uses the service role (it reads the plan, charges usage and saves the guide, as the app
does), and only for the `user_id` on a job row that the student's own request created.

**Rate limits and audit log.**
- **Rate limits:** `mcp_take_call()` allows 120 reads and 30 writes a minute per student.
- **Audit log:** `mcp_tool_calls` records the tool, status, an error code and the time taken. It
  never stores arguments or results, admins alone can read it, and it is kept for 90 days. A daily
  job (`mcp-activity-cleanup`) also drops answer receipts after 30 days and job inputs a day after
  the job ends.

### Turning it on

1. In the Supabase SQL editor, run `supabase/migrations/20261102120000_mcp_write_tools.sql`.
2. Run `supabase/checks/oauth_lockdown.sql`. It must return no rows.
3. Merge the PR. Vercel deploys the tools and the app changes.
4. Deploy the backend: `cd backend && fly deploy`. This adds the study-set worker, `/study-set-jobs`
   and `/mcp/study-sets`. Then watch `fly logs`.

### Testing

- **Claude.ai.** The connector lists 12 tools. Try these:
  - "Quiz me on what's due and log my answers." Check the cards' next review dates in Cordia
    afterwards.
  - "Make a study set from this text: …", then "Is it done yet?".
  - "Save this summary as a note in my Biology course." It appears in the Library with
    "Added from Claude".
  - "Add these three flashcards to my Cell biology set."
- **Local.** `bash tests/oauth/run_local_probe.sh` runs every write tool with a real connected-app
  token against a local stack and the real backend.

## Phase 4: prompts, instructions and icon

**Prompts.** A student can pick one of these in their AI app (`lib/mcp/prompts.mjs`). Each is a
short message that names the tools to use.

| Prompt | Arguments | What it does |
|---|---|---|
| `study_now` | `course_id` (optional) | Today's review from `get_due_cards`, in Study now's order. Every answer is logged with `record_answer`. |
| `quiz_me` | `study_set_id` | Ten questions from one study set, mixing flashcards and quiz questions. Every answer is logged. |
| `review_lecture` | `lecture_id` | Walks through the lecture's "Watch for" points with quotes and timestamps, then quizzes on them. These answers aren't logged, because they aren't Cordia cards. It offers to save misses as a note. |

All three use the same quiz rules: one question at a time, the student's confidence before
anything is revealed, and correctness judged by meaning.

**Instructions.** `MCP_INSTRUCTIONS` in `lib/mcp/config.mjs` sets these rules:
- Search first and cite titles and lecture timestamps.
- Quiz one question at a time and log every answer.
- Use `weak_topics` to choose what to review.
- Add to the Library only when the student asks.
- Never promise Canvas or other LMS data.

**Icon.** The server reports `serverInfo.icons`: the Cordia mark at
`https://classroom.cordiacode.com/cordia-mcp-icon.png` (512×512), plus a description and website.
- Clients that follow the MCP spec (2025-11-25) show this icon.
- Claude.ai doesn't use it for custom connectors yet. It shows the favicon Google has for the
  connector's apex domain, `cordiacode.com` (see `anthropics/claude-ai-mcp#152`).
- To change the icon in Claude.ai, give `cordiacode.com` a square favicon, for example
  `<link rel="icon" href="/favicon.png">` pointing to the same Cordia mark.

## Phase 5: hardening, docs and submission

**What's added:**
- **Tests:**
  - every tool's annotations against a snapshot;
  - limits on every input;
  - isolation for every tool that takes an id, run in the probe against a real stack;
  - an import-graph test that keeps the backend's `/mcp` routes away from LMS and connector code;
  - the full study-set job lifecycle.
- **Public docs:** `/connect/claude`, and section 6 of the privacy policy.
- **Demo content:** `backend/scripts/seed_demo_account.py`.
- **Submission:** `docs/SUBMISSION.md`, the submission packet and deployment checklist.

### End-to-end checklist (before submitting)

1. **MCP Inspector against a preview deploy.** Connect as in Phase 1, using the preview's host on
   the consent page. Then:
   - Tools › List Tools shows 12; run each one.
   - Prompts › List Prompts shows 3; get each one.
2. **Claude.ai custom connector.** Add `https://classroom.cordiacode.com/mcp`, sign in with the demo
   account and choose Allow.
3. **Every tool and prompt in Claude.** Use the reviewer steps in `docs/SUBMISSION.md` (section 8),
   then check the results in the Cordia app.
4. **Disconnect.** In Settings › Connectors, Claude's next call fails and asks to reconnect.
