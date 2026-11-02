# Cordia Classroom: Claude Connectors Directory submission

This is everything the developer portal asks for, ready to copy. Submit it at
[claude.ai/directory/manage](https://claude.ai/directory/manage) with **Submit new › MCP connector**.
The requirements below follow the portal pages as of November 2026:
[submission](https://claude.com/docs/connectors/building/submission) and
[review criteria](https://claude.com/docs/connectors/building/review-criteria).

Fields marked **[YOU]** need something only you can provide.

## 1. Connection

| Field | Value |
|---|---|
| Server URL | `https://classroom.cordiacode.com/mcp` |
| Users connect to different URLs | No: one URL for everyone |
| Transport | Streamable HTTP (stateless) |

## 2. Tools

The portal reads these from the server. Every tool has a `title` and all four hints:
`readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. None is destructive.
`web/tests/mcp-hardening.test.mjs` keeps this table in step with the code.

| Tool | Title | Read-only | Destructive | Idempotent | Open world |
|---|---|---|---|---|---|
| `search_my_materials` | Search my study materials | ✓ | – | ✓ | – |
| `list_study_sets` | List my study sets | ✓ | – | ✓ | – |
| `get_study_set` | Get a study set | ✓ | – | ✓ | – |
| `list_lectures` | List my lectures | ✓ | – | ✓ | – |
| `get_lecture` | Get a lecture | ✓ | – | ✓ | – |
| `get_due_cards` | Get cards due for review | ✓ | – | ✓ | – |
| `get_progress` | Get my study progress | ✓ | – | ✓ | – |
| `get_job_status` | Check a study set job | ✓ | – | ✓ | – |
| `record_answer` | Record an answer | – | – | ✓ | – |
| `create_study_set` | Create a study set | – | – | – | – |
| `add_flashcards` | Add flashcards | – | – | – | – |
| `save_note` | Save a note | – | – | – | – |

**Prompts:** `study_now` (`course`), `quiz_me` (`study_set`), `review_lecture` (`lecture`). Each argument is optional and takes a name or an id.

**Server info:**
- name and title "Cordia Classroom", version 0.4.0
- a description
- `websiteUrl`
- `icons`: the Cordia mark at `https://classroom.cordiacode.com/cordia-mcp-icon.png`
- `instructions`

## 3. Listing

| Field | Value |
|---|---|
| Server name (≤100) | Cordia Classroom |
| One-liner (≤200) | Study from your own Cordia notes, lectures and flashcards in Claude: search what your professor taught, get quizzed, and save new cards back to your Library. |
| Categories (1–5) | Education; Productivity **[YOU: pick from the portal's list]** |
| Documentation URL | https://classroom.cordiacode.com/connect/claude |
| Privacy policy URL | https://classroom.cordiacode.com/privacy (section 6, "Connected AI Apps") |
| Support contact | jsmoore588@gmail.com |
| Icon | `web/public/cordia-mcp-icon.png` (512×512 PNG, the Cordia mark) |
| URL slug | `cordia-classroom` **[YOU: the slug is permanent once published]** |

**Description (≤2,000 characters):**

> Cordia Classroom turns your course material into study sets, lecture notes and flashcards. This
> connector brings that material into Claude, so answers come from what your professor actually taught.
>
> - Search your study sets, flashcards, notes and lecture transcripts. Lecture results come with the
>   moment the professor said it.
> - Open a study set's outline and key terms, or a lecture's "Watch for" points, to-dos and transcript.
> - Review what's due: Claude quizzes you from the cards Cordia's Study now would show today, one
>   question at a time, asking how sure you are before revealing the answer.
> - Every answer is recorded in Cordia, so your review schedule and progress update as if you had
>   studied in the app.
> - See your streak, study minutes, quiz accuracy and weakest topics.
> - Ask Claude to make a study set from text or a public web page, add flashcards to a set, or save a
>   note to your Library.
>
> The connector only adds: it never deletes or changes your existing study material. It can't see
> Canvas or other LMS data (assignments, grades, due dates) or your other connected accounts.
> Disconnect any time in Cordia's Settings.

## 4. Use cases

**Primary use cases:**
1. Answer questions about a course from the student's own notes and lecture transcripts, with
   timestamps.
2. Quiz the student on what's due today and record the results.
3. Turn study material or a conversation into study sets, flashcards and notes.
4. Check study progress and choose what to review.

| Field | Value |
|---|---|
| What users need first | A Cordia Classroom account (free or Plus) with some study material. Study sets made through Claude count against the plan's monthly limit, like sets made in the app. |
| Reads or writes | Both. Eight read-only tools and four add-only write tools. |

## 5. Company

| Field | Value |
|---|---|
| Company name | **[YOU]** |
| Website | https://classroom.cordiacode.com |
| Primary contact for review | **[YOU]** (name and email) |

## 6. Authentication

| Field | Value |
|---|---|
| Authentication requirement | Required |
| Method | OAuth 2.1 (authorization code with PKCE) through Supabase Auth's OAuth server, with dynamic client registration. Claude registers itself, so no client ID or secret goes in the portal. |
| Authorization server | `https://xoolkofwihjasrvjpbrs.supabase.co/auth/v1`, advertised by `https://classroom.cordiacode.com/.well-known/oauth-protected-resource/mcp` |
| Consent page | `https://classroom.cordiacode.com/oauth/consent`. It names the app, lists what it can and can't do, and refuses callbacks outside claude.ai and chatgpt.com. |
| Callback used by Claude | `https://claude.ai/api/mcp/auth_callback` |

Tokens are checked on every request:
- the signature against the JWKS;
- the issuer, the audience (`https://classroom.cordiacode.com/mcp`) and the expiry;
- `client_id` and role `mcp_client`;
- that the grant is still active (Disconnect takes effect immediately).

App sign-in tokens are refused.

## 7. Data handling

| Field | Value |
|---|---|
| Underlying API | Our own (Cordia Classroom's database and backend) |
| Personal health data | No |
| Sponsored content | No |

## 8. Test & launch

**Reviewer test account:**
- Email: **[YOU: the demo account's email]**
- Password: **[YOU]** (entered only in the portal)

The account is filled by `backend/scripts/seed_demo_account.py` (see the deployment checklist). It
has three courses (BIO 101, HIST 210, CHEM 120), six study sets, two recorded lectures with
transcripts and "Watch for" points, flashcards due today, a question missed while sure, and two weeks
of study history.

**Instructions for reviewers:**
1. In Claude: Settings › Connectors › Add custom connector. Paste
   `https://classroom.cordiacode.com/mcp`, then Connect.
2. Sign in with the test account and choose Allow on Cordia's consent page.
3. Try:
   - "What did my professor say about the electron transport chain? Include timestamps." (search,
     get_lecture)
   - "Quiz me on what's due today and log my answers." (get_due_cards, record_answer)
   - "How's my studying going this month?" (get_progress)
   - "List my study sets and show me the outline of Causes of World War I." (list_study_sets,
     get_study_set)
   - "Make a study set from this text: <paste a paragraph>", then "Is it done?" (create_study_set,
     get_job_status; about a minute)
   - "Add two flashcards about the Treaty of Versailles to that study set." (add_flashcards)
   - "Save a summary of this chat as a note in my History course." (save_note)
   - The prompts Study now, Quiz me and Review a lecture.
4. To see the effect, sign in at https://classroom.cordiacode.com with the same account. Answered
   cards have new review dates, and new items show "Added from Claude".

Confirm in the portal that every tool was run through MCP Inspector and as a custom connector
(checklist below).

## 9. Compliance

All seven acknowledgments apply as written:
- **Directory guidelines:** the checklist below.
- **First-party API usage:** our own service only.
- **Financial transactions:** none.
- **AI media generation:** none; the connector makes text study material.
- **Prompt injection:** the descriptions describe each tool and point only to Cordia's own tools.
- **Conversation data collection:** the server stores no conversation content. The audit log holds
  only metadata, and `record_answer` keeps only the length of the student's answer.
- **Public documentation:** `/connect/claude`.

## Technical requirements checklist

| Requirement | How Cordia meets it | Where |
|---|---|---|
| Remote server over HTTPS | Vercel, `https://classroom.cordiacode.com/mcp` | `web/pages/api/mcp.js`, `next.config.js` |
| Streamable HTTP | MCP TypeScript SDK `createMcpHandler`, stateless | `web/lib/mcp/endpoint.mjs` |
| OAuth for user data | Supabase OAuth 2.1; RFC 9728 metadata; 401 with `WWW-Authenticate` and `resource_metadata` | `web/lib/mcp/auth.mjs`, `web/tests/mcp-auth.test.mjs` |
| Every tool has `title` and `readOnlyHint` or `destructiveHint` | All four hints on all 12 tools, checked against a snapshot | `web/tests/mcp-hardening.test.mjs` |
| Tool names ≤64 characters, separate read and write tools | 12 snake_case tools, no catch-all tool | same |
| Narrow, accurate descriptions with no injection patterns | Tested: 1–3 sentences, no links, only Cordia's own tools named | same |
| Useful errors | Tool errors have `isError: true` and a recoverable message; another student's id gives the same answer as a missing one | `tests/oauth/probe.mjs` (isolation checks) |
| Inputs validated | Zod schemas cap every string, list and number; unknown fields refused; ids must be UUIDs | `web/tests/mcp-hardening.test.mjs` |
| Reasonable response size | About 20,000 characters at most; long results paged with cursors | `web/lib/mcp/output.mjs` |
| No conversation data collected | Only metadata logged (`mcp_tool_calls`, 90 days); answer text never stored | `supabase/migrations/20261102120000_mcp_write_tools.sql` |
| No use of Claude's memory or files | The server only answers tool calls | — |
| First-party API, matching domain | Cordia's own database and backend, on cordiacode.com | — |
| No money movement, no AI media | Study text only | — |
| Privacy policy | Section 6 covers what's shared, conversations, records kept and revoking | `web/pages/privacy.js` |
| Documentation | Setup, examples, tools, limits, disconnecting, support | `web/pages/connect/claude.js` |
| Student data isolation | Each request runs as the student (RLS); never the service role in a tool | `tests/rls/*.sql`, probe |
| No LMS data (Cordia's own rule) | Column grants, a restrictive policy, LMS links refused, import-graph test | `tests/test_mcp_hardening.py`, `web/tests/mcp-read-tools.test.mjs` |
| Rate limits | 120 reads and 30 writes a minute per student; plan limits on study sets | `mcp_take_call()` |

## Before you submit

- [ ] The connector is connected in Claude, and each of the 12 tools and 3 prompts has run there.
- [ ] Each tool has run in MCP Inspector against a local stack (see `docs/mcp/SETUP.md`), or in Claude.ai.
- [ ] The demo account is seeded and its password is ready for the portal.
- [ ] You've reviewed the privacy policy section (it's marked for your review in the code).
- [ ] cordiacode.com has a square favicon, so Claude shows the Cordia mark (optional).

# Deployment checklist

## Environment variables

| Where | Variable | Value |
|---|---|---|
| Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Already set |
| Vercel | `NEXT_PUBLIC_API_URL` | The Fly backend URL (already set) |
| Vercel (optional) | `MCP_TOKEN_AUDIENCE`, `MCP_ALLOWED_ORIGINS`, `CLASSROOM_API_URL` | Defaults are right for production |
| Fly | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already set |
| Fly (optional) | `SUPABASE_PUBLISHABLE_KEY`, `MCP_TOKEN_AUDIENCE`, `GENERATION_WORKER` | Defaults are right |
| Fly (optional) | `LEARNING_EVENTS_ENABLED=true` | Turns on the answer log for app and Claude answers alike |

No new secrets. No secret is ever sent to the browser or committed.

## Supabase dashboard

- Authentication › OAuth Server: **enabled**; authorization path `/oauth/consent`; dynamic client
  registration **on**. (Done in Phase 1.)
- Authentication › URL Configuration: Site URL `https://classroom.cordiacode.com`.
- Authentication › Hooks: custom access token hook `public.custom_access_token_hook`. (Done in
  Phase 1.)
- SQL editor: all MCP migrations have run, from `20261031120000_oauth_lockdown.sql` to
  `20261102120000_mcp_write_tools.sql`. `supabase/checks/oauth_lockdown.sql` returns no rows.
- Cron: `mcp-oauth-client-cleanup` (weekly) and `mcp-activity-cleanup` (daily) are scheduled.

## DNS

Nothing new for the connector. Optionally, give `cordiacode.com` a square favicon. Claude.ai shows
the apex domain's favicon on custom connectors until it supports `serverInfo.icons`.

## Seed the demo account

1. Deploy the backend first (`cd backend && fly deploy`), so the script ships. Then preview what it
   would write, and apply it:

   ```
   fly ssh console -C "env DEMO_EMAIL=<demo email> python scripts/seed_demo_account.py"
   fly ssh console -C "env DEMO_EMAIL=<demo email> python scripts/seed_demo_account.py --apply"
   ```

2. It refuses any account that holds study sets it didn't make.
3. It can run again to refresh the due dates before a review.

## Release order

1. Merge the PR. Vercel deploys the page, the privacy section and the tests.
2. Run `cd backend && fly deploy`, then `fly logs`.
3. Seed the demo account, then sign in to it once to check it.
4. Run the end-to-end checklist in `docs/mcp/SETUP.md` (Claude.ai, then every
   tool and prompt).
5. Submit in the developer portal.
