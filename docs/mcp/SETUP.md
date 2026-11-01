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
