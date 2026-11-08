# Cordia Classroom: AEO baseline, November 2026

The verified starting point for every later AEO change. It covers security exposure, legacy domains, the public pages as crawlers see them, product facts taken from the code, and a copy sweep.

- **Audited:** 2026-11-08, on `main` at `0c785ae` (merge of #228).
- **Live checks:** production at `https://classroom.cordiaai.io` matches this build on every public route checked (title, description, canonical, robots, H1 count, JSON-LD and text length).
- **Method:** see [Method](#method). Every fact below cites `file:line`.
- **Redactions:** secrets show at most their first 6 characters.
- **Kept out of this file:** this repository is public, so names, emails, billing records, infrastructure IDs and how to abuse open weaknesses are not written here. The owner received those in private.

## Summary of problems, ranked by risk

| # | Risk | Problem | Evidence | Fix |
|---|---|---|---|---|
| 1 | High | **The repository is public, and so is every PR.** AI engines cite it. | `visibility: public`, `private: false`; `has_issues: false`, so there are 0 issues; 228 PRs, all readable logged out. | Make the repo private, or move internal write-ups out of PR bodies (see #2–#4). |
| 2 | High | **PR bodies read like internal security reports.** Some describe weaknesses before the fixing migration was applied; one describes a weakness that is still live (#3). | 30 findings across #17, #43, #52, #64, #72, #75, #98, #101, #183, #193, #203, #204 and others (§1c). | Edit the worst PR bodies (owner list sent privately). Use a short PR template that leaves out security internals. |
| 3 | High | **A public endpoint can hold shared content without signing in,** and a public PR (#203) explains it. | `backend/routers/public_forms.py:95-129`. Rate limit 5 per hour (line 95). | Require sign-in or review before a hold takes effect. Then edit #203. |
| 4 | High | **A Stripe promotion code was committed** and is still in git history. A public PR names it and says it "must be deactivated". | PRs #52 and #64. Code withheld here. | Confirm it is deactivated in Stripe. Then edit #52. |
| 5 | Medium | **Personal and billing details** of real accounts are in PR bodies: a named account, a Stripe customer ID, subscription history. | PRs #72 and #75. | Edit both bodies. |
| 6 | Medium | **Production schema is published:** 65 tables, every constraint and RLS policy. Infrastructure names are in PR bodies and every Vercel bot comment. | `supabase/schema/live-2026-11.sql`; 224 vercel[bot] comments with 71 preview URLs. | Accept or move the file. Confirm Vercel Deployment Protection is on for previews. |
| 7 | Medium | **CodeQL alerts are public** with file and line: SSRF, XSS-class and clear-text storage, some left open. | Review comments on #92, #98, #104, #160, #218, #220. | Triage and close or dismiss them. |
| 8 | Medium | **`www.autostudyai.online` has an expired TLS certificate.** It expired 2026-06-27, so browsers block the redirect. | §2 | Re-add the `www` host to the Vercel project, or remove its DNS record. |
| 9 | Medium | **Old domain URLs take 2 hops over plain `http`:** http to https on the old host, then the new host. Over https it is 1 hop (308). | §2 | Redirect `http://` straight to `https://classroom.cordiaai.io` at the edge. |
| 10 | Medium | **Prices are wrong in 3 public places.** The terms, the `/mission` meta description and the extension popup say "$9.99/month or $29/semester". The code sells Pro at $4.99/month and Academic Weapon at $9.99/month, monthly only. | `web/pages/terms.js:69`, `web/pages/mission.js:25`, `extension/popup.html:65` versus `backend/routers/billing.py:3-4` and `web/lib/plans.js:8-23` | Align copy with `plans.js`. |
| 11 | Medium | **Limits are wrong or "unlimited" in copy.** The terms say 120 free recording minutes; the code enforces 30. The extension promises "unlimited guides … unlimited Cordia Tutor"; paid tiers are capped. | `terms.js:69`, `extension/popup.js:45` versus `backend/services/entitlements.py:37-78` | Fix the copy. |
| 12 | Medium | **The privacy policy omits Anthropic,** the first-choice AI provider in code. | `web/pages/privacy.js:77` versus `backend/services/models.py:4-6, 39-45` | Add Anthropic to the provider list. |
| 13 | Medium | **No JSON-LD on any page.** | §3 | Add Organization and WebApplication with Offers (AEO SERP5). |
| 14 | Medium | **The home page has no plain description in its HTML.** It has an H1 "Cordia Classroom", a looping feature ticker (`aria-hidden`), and the sign-in form. `/login` and `/signup` reuse the home title and description. | `web/pages/index.js:40-51`; `/login`, `/signup` | Add an entity sentence plus answer-first copy. Give `/login` and `/signup` their own titles, or noindex them. |
| 15 | Low | **Brand spelled "CordiaClassroom"** (no space): every app tab title, the extension name and description, the popup and error messages. | `web/lib/pageTitle.js:4`, `extension/manifest.json:3,5,29`, §5 | Use "Cordia Classroom" everywhere. |
| 16 | Low | **Old domain still in copy:** `classroom.cordiacode.com` is the MCP server URL on `/connect/claude`, the OAuth token audience and the fetcher User-Agent, and appears throughout `docs/SUBMISSION.md`. | §5 | Move to `classroom.cordiaai.io` with a token-audience migration. |
| 17 | Low | **Every page shares one Open Graph title and description.** App routes are indexable shells with no `noindex`. `robots.txt` still has a template comment. | `web/pages/_app.js:62-68`, §3 | Per-page OG; `noindex` on app routes; tidy `robots.txt`. |
| 18 | Low | **Heading problems.** `/mission` skips from h1 to h3. `/404` puts an h2 before its h1, from the app sidebar it shows to logged-out visitors. | §3 | Fix the levels. |
| 19 | Low | **A staff member's address is the public contact** on the privacy page and the OAuth consent page. Everywhere else uses the support address. | `web/pages/privacy.js:202`, `web/lib/mcp/config.mjs:12` | Use the support address. |
| 20 | Low | **Next.js dev-build keys** (preview and encryption keys) are in history. They are not in HEAD. | §1b | Rotate only if those build values were ever reused. |
| – | OK | **No server secret reaches the browser bundle.** No API keys, tokens or real `.env` values anywhere in history. No phone numbers or student names in PRs. | §1b, §1c, §1d | – |

---

## 1. Security

### 1a. Repository visibility

`gh repo view --json visibility,url` is blocked here (GraphQL), so the same data came from the REST API (`gh api repos/CordiaAI/cordia-classroom`):

| Field | Value |
|---|---|
| visibility | `public` |
| private | `false` |
| url | https://github.com/CordiaAI/cordia-classroom |
| has_issues / has_wiki / has_pages | `false` / `false` / `false` |
| forks / stars | 0 / 1 |
| created | 2026-02-05 |

The repository page and `/issues` both return 200 when fetched without a GitHub login.

### 1b. Secrets in git history

**Scope:**
- All 81 remote branches plus all 228 PR head refs (`refs/pull/*/head`, which GitHub keeps public even after a branch is deleted).
- 958 commits in total.
- The clone was unshallowed first.

**Tools:**
- `gitleaks 8.21.2` (`gitleaks git --log-opts=--all --redact`).
- A pattern scan of `git log -p --all` for every requested pattern:
  - API key prefixes: `sk-ant-`, `sk-proj-`, `sk-`, `gsk_`, `AKIA`, `ghp_`, `github_pat_`, `xoxb-`, `AIza`, `whsec_`, `sk_live_`, `rk_live_`
  - Supabase: `SUPABASE_SERVICE_ROLE_KEY` and `service_role`
  - Private keys and JWTs: `-----BEGIN` and `eyJhbGciOi`

The scan kept only the first 6 characters of any match.

| # | Service | File | Commit | Date | Prefix | In HEAD? | Assessment |
|---|---|---|---|---|---|---|---|
| 1 | Supabase publishable key | `backend/database.py:102` | `acc67bb028` | 2026-11-01 | `sb_pub` | Yes | Browser-safe by design; protected by RLS. Not a secret. |
| 2 | Supabase publishable key (same value) | `web/lib/supabaseUrl.mjs:6` | `6bc25151b1` | 2026-10-30 | `sb_pub` | Yes | As above. It is also in the browser bundle, as intended. |
| 3 | Next.js dev build: encryption key | `web/.next/dev/cache/.rscinfo:1` | `75ca96cfd0` | 2026-02-25 | (redacted) | No; `web/.next` was removed and is not tracked | Per-build dev-server key. Low risk. |
| 4 | Next.js dev build: preview-mode signing key | `web/.next/dev/prerender-manifest.json:8` | `75ca96cfd0` | 2026-02-25 | (redacted) | No | As above. |
| 5 | Next.js dev build: preview-mode encryption key | `web/.next/dev/prerender-manifest.json:9` | `75ca96cfd0` | 2026-02-25 | (redacted) | No | As above. |
| 6 | Next.js dev build: server-actions encryption key | `web/.next/dev/server/server-reference-manifest.json:4` | `75ca96cfd0` | 2026-02-25 | (redacted) | No | As above. |
| 7 | `SUPABASE_SERVICE_ROLE_KEY=` (placeholder) | `backend/.env.example:10`, `tests/test_shared_tutor_session_contract.py:278` | `f95c034612` | 2026-09-16 | `your-s` | Yes | A placeholder, not a key. |

**Other results:**
- **No hits** for `sk-ant-`, `sk-proj-`, `sk-`, `gsk_`, `AKIA`, `ghp_`, `github_pat_`, `xoxb-`, `AIza`, `whsec_`, `sk_live_`, `rk_live_`, `-----BEGIN … PRIVATE KEY-----`, or JWT strings.
- **No real `.env` file** was ever committed. Only `backend/.env.example` and `web/.env.example` exist. Every value they hold for the Stripe secret, webhook secret, OpenAI key, Stripe price ID and publishable key ends in `...` in every version.
- **Names only:** `service_role` and `SUPABASE_SERVICE_ROLE_KEY` appear as names (not values) in 28 and 30 files: code, tests, docs and migrations.
- **Not a secret scan:** one committed Stripe promotion code is in history (Summary #4). Promotion codes don't match secret patterns; it was found by the PR review (§1c).

### 1c. Issues and pull requests

**Read:** every PR title, body and branch name, 238 conversation comments, 98 review comments and 69 reviews, all through the REST API. Nothing on GitHub was changed.

**Counts:**
- **Issues:** 0 (disabled).
- **PRs:** 228 (0 open; 218 merged, 10 closed unmerged).
- **Conversation comments:** 238, of which 224 are vercel[bot] and 9 dependabot.
- **Review comments:** 98, of which 54 are CodeQL.

**Not found:** API keys or tokens (even partial), phone numbers, database connection strings or hostnames, `*.supabase.co` URLs, real user UUIDs, or student names tied to grades or study content.

**Flagged.** Excerpts and identifiers are withheld because this file is public; the owner has the full list.

| Severity | PRs | What is exposed |
|---|---|---|
| High | #203, #204 | An audit listing weaknesses: browser write policies, an unauthenticated takedown form, join-by-code. #204 marks the fixing migration "NOT APPLIED". **Status checked 2026-11-08:** the browser write policies are gone in production (no INSERT, UPDATE, DELETE or ALL policies on `study_guides`, `folders`, `quiz_attempts`, `study_sessions` or `user_streaks`). The takedown form is unchanged (Summary #3). |
| High | #183 | OAuth lockdown write-up with step-by-step exploit paths that were open before the fix: password change by token, an open insert policy, a callable network function. |
| High | #52, #64 | A live Stripe promotion code, and a statement that it remains in history. |
| High/Medium | #75 | A named account's subscription and receipt-email mismatch. |
| Medium | #72 | A Stripe customer ID and an account's billing row and dates. |
| Medium | #17, #101, #102, #103, #189 | Supabase project reference, backend app name, the backend host and the CORS allowlist. |
| Medium | all PRs | Vercel bot comments: project and team IDs, team slugs, 71 preview URLs. |
| Medium | #193, #43, #45, #171, #177 | Staff email addresses and an email local part. |
| Medium | #92, #98, #104, #160, #218, #220 | CodeQL alerts with file and line (SSRF, XSS-class, clear-text storage), some noted as still open. |
| Medium | #52, #197, #198, #212, #216, #227 | How admin, reviewer and unlimited access is decided (env lists of user IDs, admin-only routes). |
| Medium | #70, #101, #84, #92 | Past vulnerabilities, since fixed (CORS, IDOR, rate-limit IP, zip bomb, SSRF, iframe). |
| Medium | #204, #205, #206, #219, #184–#186, #226, #198 | Detailed RLS and grant design. Announces the public production schema dump. |
| Medium | #203, #216 | Rate limits are in memory per machine, with no daily caps. |
| Low | #99, #29, #35, #69, #159, #161, #185, #198, #225 | One school's LMS domain; production usage counts; a user's file name; a feedback report ID. |
| Low | #26, #201, #21, #52, #98, #101, #104, #105, #108, #114, #116, #164, #176, #183, #225 | Deploy workflow, secret *names* and where they are set, another repo's internals. |

**Pattern:** generated PR bodies describe RLS, grants, admin gating and audit findings in detail. That is the main ongoing risk while the repo is public.

### 1d. Server-only secrets and the browser bundle

| Secret (env name) | Read in | Can it reach the browser? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `web/lib/server/*.mjs`, `web/pages/api/*`; backend | No |
| `NAPKIN_API_KEY` | `web/lib/server/napkinVisual.mjs`, `web/pages/api/visual.js` | No |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` | `web/lib/server/aiProvider.mjs` and other `lib/server` modules; backend `services/models.py` | No |
| `CANVAS_TOKEN_KEY` | backend only, `backend/services/canvas_client.py:102` | No; not used in `web/` |

**How this was checked:**
1. **Who reads secrets.** Only 13 files in `web/` read a server-only secret. All are under `web/lib/server/` or `web/pages/api/`, and those modules are imported only by `web/pages/api/*` and other `lib/server` modules. Four client libs mention `lib/server/` only in comments.
2. **No public names.** No `NEXT_PUBLIC_` variable holds a secret. `web/next.config.js` has no `env:` block.
3. **The built bundle.** After `next build`, `web/.next/static` has 0 files containing:
   - the names `SUPABASE_SERVICE_ROLE_KEY`, `NAPKIN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `CANVAS_TOKEN_KEY`, `STRIPE_SECRET` or `service_role`;
   - the key prefixes `sk-ant-`, `sk_live_`, `whsec_` or `gsk_`.
   The only key in the bundle is the Supabase publishable key, which is meant to be there.

---

## 2. Domains

`curl -sIL` over http and https. The agent proxy's `200 Connection Established` lines are removed; every remaining line is a real response.

| URL | Hops | Meets the rule? |
|---|---|---|
| http://classroom.cordiacode.com/ | 308 → https://classroom.cordiacode.com/ → 308 → https://classroom.cordiaai.io/ → 200 | No: 2 hops |
| https://classroom.cordiacode.com/ | 308 → https://classroom.cordiaai.io/ → 200 | Yes: 1 permanent hop, same path |
| http://classroom.cordiacode.com/mission | 308 → https://classroom.cordiacode.com/mission → 308 → https://classroom.cordiaai.io/mission → 200 | No: 2 hops |
| https://classroom.cordiacode.com/mission | 308 → https://classroom.cordiaai.io/mission → 200 | Yes |
| http://classroom.cordiacode.com/pricing | 308 → https://classroom.cordiacode.com/pricing → 308 → https://classroom.cordiaai.io/pricing → 200 | No: 2 hops |
| https://classroom.cordiacode.com/pricing | 308 → https://classroom.cordiaai.io/pricing → 200 | Yes |
| http://autostudyai.online | 308 → https://autostudyai.online/ → 308 → https://classroom.cordiaai.io/ → 200 | 2 hops |
| https://autostudyai.online | 308 → https://classroom.cordiaai.io/ → 200 | 1 hop |
| http://www.autostudyai.online | 308 → https://www.autostudyai.online/ → **TLS error** (curl 60, certificate expired) | **Broken** |
| https://www.autostudyai.online | **TLS error**. Certificate `CN=www.autostudyai.online` from Let's Encrypt R13, valid 2026-03-29 to **2026-06-27**. The bare `autostudyai.online` certificate is valid to 2026-12-28. | **Broken** |
| http://cordiacode.com | 200 (served over plain http with no redirect to https) | Doesn't redirect, as intended. Not upgraded to https. |
| https://cordiacode.com | 200, `<title>Cordia</title>` | Yes: Cordia Workspace, no redirect |
| http://cordiaai.io | 308 → https://cordiaai.io/ → 200 | – |
| https://cordiaai.io | 200, `<title>CordiaAI Homepage</title>` | Serves its own page. It doesn't redirect to Classroom or to the Assistant. |
| http://dashboard.cordiaai.io | 308 → https://dashboard.cordiaai.io/ → 200 | – |
| https://dashboard.cordiaai.io | 200, `<title>Cordia Discovery</title>` | A separate site |
| http://classroom.cordiaai.io | 308 → https://classroom.cordiaai.io/ → 200 | Canonical host |
| https://classroom.cordiaai.io | 200 | Canonical host |

---

## 3. Public site inventory

### Rendering

`next build` (Next.js 16.4.2, Pages Router) pre-renders every page as static HTML (○). **No page uses `getStaticProps`, `getServerSideProps` or `getInitialProps`.**

What ends up in the server HTML depends on the page:
- Marketing pages render their text at build time.
- Auth-guarded pages (`useRequireAuth`) render only the app shell.
- `/sets/[id]` and `/join/[token]` render their content client-side.

All server HTML below was fetched with `next start` and plain HTTP (no browser). Production returned the same.

### Public routes (work logged out)

All are static. OG is the Open Graph tags; **every** page gets `og:site_name` "Cordia Classroom", `og:title` "Cordia Classroom", the same `og:description` "Turn course material into focused study guides, notes, flashcards, and practice.", `og:image` `/og-image.png` (1200×630) and `twitter:card` `summary_large_image`, all from `web/pages/_app.js:62-68`. `PublicPage` (`web/components/PublicPage.js:18-22`) adds the title, description, canonical and `og:url`. **JSON-LD: none on any page.** **Robots meta:** none unless stated, so the page is indexable.

| Route | File | Title | Meta description | Canonical | H1s | Skipped levels | Main text in server HTML |
|---|---|---|---|---|---|---|---|
| `/` | `web/pages/index.js` (`Landing`, :21-77) | Cordia Classroom — AI Study Guides, Notes & Flashcards | Turn lectures, textbooks, and course pages into focused study materials. | https://classroom.cordiaai.io/ | 1 ("Cordia Classroom") | none (only h2 "Sign in") | Partly: 1,167 chars, mostly the feature ticker 3 times plus the sign-in form. No descriptive paragraph. |
| `/login` | `web/pages/login.js` (renders `Landing`) | same as `/` | same as `/` | …/login | 1 | none | Same as `/` |
| `/signup` | `web/pages/signup.js` | same as `/` | same as `/` | …/signup | 1 | none | Same as `/` (1,144 chars) |
| `/pricing` | `web/pages/pricing.js` (:66) | Pricing — Cordia Classroom | Cordia Classroom Free, Pro and Academic Weapon plans. | …/pricing | 1 | none | Yes: all three plans, prices and limits (871 chars) |
| `/mission` | `web/pages/mission.js` (:34) | Features — Cordia Classroom | How Cordia Classroom turns your own course material into study guides, quizzes and flashcards. | …/mission | 1 ("Features") | **h1→h3** | Yes (1,770 chars) |
| `/honor-code` | `web/pages/honor-code.js` (:5) | Honor Code — Cordia Classroom | Using Cordia Classroom with academic integrity. | …/honor-code | 1 | none | Yes (2,710 chars) |
| `/instructors` | `web/pages/instructors.js` (:83) | Instructors — Cordia Classroom | Turn off class sharing for your course. | …/instructors | 1 | none | Yes (571 chars) |
| `/install-extension` | `web/pages/install-extension.js` (:9) | Get the Chrome extension — Cordia Classroom | Install the Cordia Classroom extension and capture course material in a few clicks. | …/install-extension | 1 | none | Yes (1,153 chars) |
| `/copyright` | `web/pages/copyright.js` (:35) | Copyright — Cordia Classroom | Report shared material that uses your work without permission. | …/copyright | 1 | none | Yes (1,470 chars) |
| `/privacy` | `web/pages/privacy.js` (:5) | Privacy Policy — Cordia Classroom | How Cordia Classroom collects, uses and protects your data. | …/privacy | 1 | none | Yes (12,348 chars) |
| `/terms` | `web/pages/terms.js` (:5) | Terms of Service — Cordia Classroom | The terms for using Cordia Classroom. | …/terms | 1 | none | Yes (5,753 chars) |
| `/connect/claude` | `web/pages/connect/claude.js` (:41) | Use Cordia Classroom with Claude | Connect Cordia Classroom to Claude to search your notes and lectures… | …/connect/claude | 1 | none | Yes (3,851 chars) |
| `/reset-password` | `web/pages/reset-password.js` (:66) | Reset Password — Cordia Classroom | default (`_app.js:62`) | none | 1 | none | Form only (63 chars) |
| `/oauth/consent` | `web/pages/oauth/consent.js` | Connect an app — CordiaClassroom | default | none | 1 | none | No ("Checking the request…"). **robots `noindex`** |
| `/auth/callback` | `web/pages/auth/callback.js` | Signing in — CordiaClassroom | default | none | 1 | none | No ("Signing in…") |
| `/join/[token]` | `web/pages/join/[token].js` (:38-39) | Join a classroom — CordiaClassroom | A classroom invite on Cordia Classroom. | …/join/ (token missing) | 0 | – | No; client-only. **robots `noindex`** |
| `/sets/[id]` | `web/pages/sets/[id].js` (:85-92) | Study guide — CordiaClassroom | default | none | 0 | – | No: 0 chars, client-only. **robots `noindex`** |
| `/404` | `web/pages/404.js` | Page not found — CordiaClassroom | default | none | 1 | **h2 before h1** | Yes, wrapped in the app sidebar |

**Sitemap and robots.txt:**
- **`/sitemap.xml`** lists `/`, `/mission`, `/pricing`, `/install-extension`, `/connect/claude`, `/instructors`, `/signup`, `/privacy`, `/terms`, `/honor-code` and `/copyright`.
- **`/robots.txt`** allows everything, points to the sitemap, and still says "(Update this to your live URL)".

### App routes (need sign-in)

These are static shells. Their server HTML is the app frame (342 chars), titled "<Page> — CordiaClassroom" with the default description, **no robots `noindex`**, and no H1.
- **Core app:** `/dashboard`, `/library`, `/calendar`, `/canvas`, `/create`, `/settings`, `/settings/privacy`, `/progress`, `/week`, `/session`, `/tutor`, `/smartnotes`
- **Study pages:** `/guide/[id]`, `/learn/[guideId]`, `/quiz/[guideId]`, `/flashcards/study`, `/nclex/[guideId]`, `/play/[guideId]`, `/print/quiz/[id]`, `/lecture/[id]`, `/practice`, `/practice/[guideId]`
- **Social and classes:** `/explore`, `/friends`, `/u/[username]`, `/class/[id]`, `/folder/[id]`, `/classrooms`, `/classrooms/[id]`, `/join`
- **Staff and other:** `/admin`, `/feedback-review`, `/assistant`, `/billing` (redirects to `/settings?section=plan`)

`/practice` has no auth guard, but its workspace needs an account and renders the app shell. Every `/api/*` route is a server function (ƒ), not a page.

---

## 4. Facts from the code

### Plans and prices

| Fact | Value | Source |
|---|---|---|
| Tiers | `TIERS = ("free", "pro", "weapon")`; names Free / "Classroom Pro" / "Academic Weapon" | `backend/services/entitlements.py:21-23` |
| Prices sold | "Classroom Pro $4.99/month (lookup key classroom_pro_499_monthly)", "Academic Weapon $9.99/month (lookup key classroom_aw_monthly)" | `backend/routers/billing.py:3-4`, `:50-51` |
| Billing interval | monthly only (`"billing_interval": None if is_trial else "monthly"`) | `billing.py:266` |
| Legacy prices | `classroom_pro_monthly` and `classroom_pro_semester` map to `weapon`; "Nobody can buy them any more" | `billing.py:52-54` |
| Promo codes at checkout | `"allow_promotion_codes": True` | `billing.py:378` |
| Web prices | Pro `'$4.99'` per `'month'`; Academic Weapon `'$9.99'` per `'month'`; Free `$0/month` | `web/lib/plans.js:8-10, 21-23`; `web/pages/pricing.js:28, 35` |
| **Stale price copy** | "costs $9.99 per month or $29 per 4-month semester" | `web/pages/terms.js:69` |
| **Stale price copy** | "Cordia Classroom Pro is $9.99 a month or $29 a semester." | `web/pages/mission.js:25` (meta) |
| **Stale price copy** | "See Pro · $9.99/mo or $29/semester" | `extension/popup.html:65` |

### Monthly limits

Limits are enforced by the backend and reset on the 1st of each month (UTC). Source: `LIMITS` at `backend/services/entitlements.py:37-78` (free :39-50, pro :54-63, weapon :67-76); labels from `FEATURE_LABELS` at :81-92. The `guide` limit is shared by the web app, the extension, Tutor-built guides and SmartNote (:35-36). The `UNLIMITED_USER_IDS` env var bypasses all limits (:135-136).

| Feature (key) | Label | Free | Pro | Academic Weapon |
|---|---|---|---|---|
| `guide` | study guides | 3 | 15 | 100 |
| `tutor` | tutor prompts | 10 | 300 | 1,000 |
| `learn_my_way` | Explain views | 5 | 300 | 300 |
| `practice` | practice sets | 1 | 15 | 75 |
| `ai_quiz` | AI quizzes | 1 | 200 | 200 |
| `nclex` | NCLEX sets | 1 | 50 | 50 |
| `retain_types` | Pro quiz sessions | 1 | 300 | 300 |
| `light` | AI reading actions | 30 | 500 | 500 |
| `lecture_minute` | recording minutes | 30 | 150 | 1,200 |
| `visual` | visuals | 10 | 10 | 200 |

**Web copy that restates the limits:**
- **Matches the backend:** Free summary in `web/lib/plans.js:54-59`; Pro benefits in `:13-17`; Academic Weapon benefits in `:26-31`, including "Record every class: 20 hours a month".
- **Disagrees with the backend:**
  - `terms.js:69` says 120 free recording minutes.
  - `extension/popup.js:45` says "unlimited guides … unlimited Cordia Tutor".
  - `plans.js:41` says "as much as you need".
  - `plans.js:49` says "without limits".

### Trial

| Fact | Value | Source |
|---|---|---|
| Length | `TRIAL_DAYS = 7` | `entitlements.py:32` |
| Tier during trial | `TRIAL_TIER = "weapon"` (Academic Weapon) | `entitlements.py:33` |
| Card required | No: "7 days of Academic Weapon, no card, one per account … can never turn into a charge on its own" | `billing.py:7-8, 433` |
| How it ends | `trial_period_days=TRIAL_DAYS`, `cancel_at_period_end=True`, `missing_payment_method: "cancel"` | `billing.py:448-450` |
| One per account | "Your free trial has already been used" | `billing.py:440-441` |
| Copy | "Try Academic Weapon free for 7 days … No card needed." | `web/components/UpgradeModal.js:226-233` |
| **Copy calling it a Pro trial** | "one 7-day Pro trial without a payment method", "Try Pro free for 7 days with no card", "New to Pro? Start a 7-day free trial, no card." | `terms.js:69`, `mission.js:25`, `extension/popup.html:66` |

### Uploads

| Path | Accepted types | Max files | Max size | Source |
|---|---|---|---|---|
| Backend, any file read | Parsed: pptx, pdf, docx, jpg/jpeg/png/gif/webp/bmp/tiff/tif. Otherwise: text that is at least 85% printable. | – | 50 MB per file; images 15 MB; 600 PDF pages; 500,000 characters of text | `backend/services/file_extraction.py:15-26, 43, 147-161, 181` |
| Backend request bodies | – | – | multipart 60 MB, JSON 8 MB | `backend/main.py:112-113` |
| New sheet (study guide) | `.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp,.heic,image/*`. `.doc`, `.ppt` and `.heic` aren't parsed by the backend. | 5 ("Up to 5 files.") | backend 50 MB | `web/components/NewSheet.js:24, 45, 265` |
| Practice upload | `.pdf,.docx,.pptx,.txt` | 1 | 50 MB | `web/lib/practiceUpload.js:17` |
| Tutor attachments | any (`accept="*"`) | 5 | backend 50 MB | `web/components/AIChatWidget.js:56, 689` |
| Lecture audio | `.mp3,.m4a,.wav,.webm,.ogg`, `audio/…` | – | Any length (split into ≤4.3 MB chunks); metered in recording minutes | `web/components/LectureRecorder.js:13`; `web/lib/server/lectures.mjs:18`; `web/lib/lectureFile.js:1-10` |
| Extension capture | pdf, pptx, docx, txt, md, csv, png, jpg, jpeg, webp | 10 images per capture | 50 MB per document | `extension/content.js:5`; `extension/background.js:4, 119`; `backend/schemas.py:23, 28` |
| Feedback screenshots | JPEG, PNG, WebP, GIF (checked by file bytes) | 3 | 5 MB each | `web/components/FeedbackModal.js:8`; `web/lib/server/cardImages.mjs:11-24` |
| Flashcard photos | JPEG, PNG, WebP, GIF | 1 | 3 MB | `web/lib/server/cardImages.mjs:7, 23` |

### Supported links

| Link | Handling | Source |
|---|---|---|
| Any page or PDF (Link field: "A page, PDF, YouTube video or Quizlet set") | Fetched by the student's browser (`fetch(url, { mode: 'cors' })`), so pages without CORS headers can't be read | `web/components/NewSheet.js:122-140, 416, 495` |
| YouTube | `youtube.com/watch`, `youtu.be`, `/shorts/`, `/live/`, `/embed/`. The transcript is read by the Chrome extension, which is required. | `web/lib/extensionBridge.js:32-44`; `NewSheet.js:297-306` |
| Quizlet | `quizlet.com` set URLs open the card importer, not a guide | `web/lib/quizletImport.js:6-13` |
| Canvas, Blackboard, Moodle and other LMS pages | Refused by the server fetcher ("Cordia can't read Canvas, Blackboard, Moodle or other LMS pages from here…"). Captured by the extension instead. | `backend/services/url_fetch.py:28-33`; `extension/content.js:6-10` |
| Google Docs, Slides, Sheets | Captured by the extension as PDF exports. The Link field has no Google parser. | `extension/content.js:18, 41-50` |
| Connected apps (MCP `create_study_set`) | Server fetch of http/https on standard ports: HTML, text, pdf, docx, pptx | `backend/services/url_fetch.py:1-10`; `backend/routers/mcp.py:115-120` |

### Learn

| Fact | Value | Source |
|---|---|---|
| Levels | `['New', 'Learning', 'Familiar', 'Mastered']`. Recognising an answer (multiple choice) only reaches Familiar; recalling it masters it. | `web/lib/learnEngine.mjs:3-4, 10` |
| Round and fade | 7 ideas a round; mastered ideas fade after 5 days | `learnEngine.mjs:15-16` |
| Ways to learn (current) | Choice ("Pick from four"), Type it ("Answer from memory"), Fill the blank ("Type the missing word"), Flashcards ("Flip and be honest"). Default `['mc', 'cloze', 'type']`. | `web/pages/learn/[guideId].js:50-55`; `learnEngine.mjs:77-78` |
| Ladder V2 (flag `NEXT_PUBLIC_LEARN_LADDER_V2`) | Multiple choice, Fill in the blank, Written answer, Flashcards. Fill in the blank is Pro. | `web/pages/learn/[guideId].js:40-47`; `web/lib/featureFlags.js:21` |

### Quiz question types

| Fact | Value | Source |
|---|---|---|
| Types | `("mc", "written", "fill", "matching")`: Multiple choice, Written, Fill in the blank, Matching | `backend/services/retain.py:19`; `web/lib/retainEngine.mjs:5-10` |
| Pro-only | `PRO_TYPES = {"fill", "matching"}`. Free accounts get 1 session a month (`retain_types`). | `retain.py:20`; `backend/routers/quiz.py:619-622` |
| Other metering | Grading a written answer costs 1 AI reading action; a guide's first set of AI wrong-answer choices counts against AI quizzes | `quiz.py:770-774, 458-463` |

### Flashcard review intervals

`INTERVALS = [1, 2, 4, 7, 15, 30]` days (`web/lib/spacedReview.mjs:4`). A right answer moves a card up one box. A miss sends it back to box 0, so it's due again in 1 day (:1-2, 56). The schedule exists only in the web app.

### AI providers

| Provider | Used for | Source |
|---|---|---|
| Anthropic (first choice when `ANTHROPIC_API_KEY` is set) | Backend: `claude-sonnet-5-5` for building (guides, questions, flashcards, notes) and vision; `claude-haiku-5-5` for light jobs (Tutor replies, grading, memory tricks, wrong-answer choices, titles). Web: Sonnet for notes and lecture writing, Haiku for cover icons. Opus overrides are ignored. | `backend/services/models.py:4-6, 39-48, 55-56, 81-120`; `web/lib/server/aiProvider.mjs:25-38` |
| Groq (when there is no Anthropic key) | `openai/gpt-oss-120b` (build and light), `qwen/qwen3.8-27b` (vision); `whisper-large-v3-turbo` for lecture transcription | `models.py:36, 41-45`; `aiProvider.mjs:6-13` |
| OpenAI (last fallback) | `gpt-4o`, `gpt-4o-mini`; `gpt-4o-mini-transcribe` for transcription | `models.py:41-45`; `aiProvider.mjs:15-21` |
| Napkin AI | Visuals (`POST https://api.napkin.ai/v1/visual`) | `web/lib/server/napkinVisual.mjs:1-14` |
| MediaPipe (on-device) | Hand tracking for Air Draw | `web/components/AirDraw.js:6-7` |

### Canvas

- **Storage:**
  - Each token is encrypted with AES-256-GCM using `CANVAS_TOKEN_KEY`, a fresh 12-byte IV, and the user ID as associated data (`backend/services/canvas_client.py:4-5, 101-116`).
  - It lives in `public.canvas_tokens` (ciphertext, iv, last4, expires_at). RLS is on with no policies, so only the service role can read it (`supabase/migrations/20261015120000_canvas_classes.sql:146-157`).
- **Read-only:** `if method.upper() != "GET": raise CanvasForbiddenRequest` (`canvas_client.py:294-295`). There are **no write requests**.
- **GET allowlist** (`canvas_client.py:274-289`):
  - `/api/v1/users/self`
  - `/api/v1/courses`
  - `/api/v1/courses/:id`
  - `/api/v1/courses/:id/assignments`
  - `/api/v1/courses/:id/assignment_groups`
  - `/api/v1/courses/:id/grading_standards`
  - `/api/v1/courses/:id/enrollments?user_id=self`
  - `/api/v1/courses/:id/modules`
  - `/api/v1/calendar_events` (defined, never called)
  - `/api/v1/announcements`
  - `/api/v1/courses/:id/files`
  - `/api/v1/courses/:id/files/:id`
  - `/api/v1/courses/:id/pages/:slug`
  - `/files/:id/download`
- **File bytes:** fetched from pre-signed hosts without the token (`:45-47`).

### Default sharing

- **Guides:** the database column defaults to `'private'` (`supabase/migrations/20261109120000_guide_visibility.sql:21, 26`). The migration header says NOT APPLIED, but production has the column with that default (checked 2026-11-08).
- **When a new guide becomes public:** guides made by the web generator, which sends `share_default: true` (`web/lib/guideCreate.js:122`), default to **public and named**, but only if:
  - the student accepted the Honor Code;
  - the student is not a minor;
  - the class's instructor hasn't turned sharing off.
  (`backend/routers/guides.py:187-203`)
- **Everything else starts private:** notes, imports, the Assistant, the extension, server jobs and MCP.
- **Copies:** private (`backend/routers/guide_sharing.py:211`).
- **Class shared sets:** default `'private'` (`canvas_classes.sql:242`).

### Chrome extension (`extension/manifest.json`)

| Field | Value | Line |
|---|---|---|
| name | `"CordiaClassroom"` | :3 |
| short_name | not set | – |
| description | `"Capture study material and create a CordiaClassroom study guide."` | :5 |
| version | `"2.1.4"` | :4 |
| permissions | `activeTab`, `scripting`, `storage`, `sidePanel`, `contextMenus` | :8 |
| host_permissions | `<all_urls>` | :9 |
| Keyboard shortcut | `_execute_action`: `Ctrl+Shift+Y`, Mac `Command+Shift+Y`, "Open the CordiaClassroom side panel" | :23-31 |
| Other | MV3, homepage `https://classroom.cordiaai.io`, minimum Chrome 114, side panel `popup.html` | :2, :6-7, :20-22 |

---

## 5. Copy sweep

**Scope:**
- **Included:** `web/pages`, `web/components`, `web/lib`, `web/public`, `extension/` (UI, manifest, README) and `docs/SUBMISSION.md`, the Claude directory listing text.
- **Excluded:** comment-only and import lines, tests, `web/pages/api` and `web/lib/server`.

**Not in the repo:**
- **Email templates:** none. Auth emails are configured outside the code, so they can't be audited from here.
- **Chrome Web Store listing text:** none in the repo.

| Term | Where | Text |
|---|---|---|
| unlimited | `extension/popup.js:45` | "Pro gives you unlimited guides from any page, unlimited Cordia Tutor, and guides that adapt to how you learn." |
| unlimited | `web/components/assistant/AssistantSettings.js:99` | "Unlimited during your Pro trial" / "Unlimited with Pro" (Assistant texts) |
| beta | `web/components/FeedbackModal.js:253` | "BETA FEEDBACK" |
| beta | `web/pages/feedback-review.js:89` | "BETA OPERATIONS" (staff page) |
| SmartNotes | route `/smartnotes` (`web/pages/smartnotes.js`) | URL only; the page title is "Notes" |
| Smart Notes | – | none |
| CordiaClassroom | `web/lib/pageTitle.js:4` | `BRAND = 'CordiaClassroom'`: every app tab title, the 404, the OAuth consent page, `/auth/callback`, `/sets/[id]`, `/join/[token]` |
| CordiaClassroom | `web/lib/guideCreate.js:64, 103` | "CordiaClassroom could not build “…” from this material." |
| CordiaClassroom | `web/components/AcademicInfinityMark.js:1` | SVG title "CordiaClassroom" |
| CordiaClassroom | `web/lib/plans.js:3` | `PRO_NAME = 'CordiaClassroom'` (defined, not shown) |
| CordiaClassroom | `extension/manifest.json:3, 5, 29` | name; "Capture study material and create a CordiaClassroom study guide."; "Open the CordiaClassroom side panel" |
| CordiaClassroom | `extension/popup.html:6, 63` | `<title>CordiaClassroom</title>`; "Upgrade to CordiaClassroom Pro" |
| CordiaClassroom | `extension/popup.js:42, 112, 283` | "Upgrade to CordiaClassroom Pro"; "Connect CordiaClassroom to make and save a guide."; "Saving your guide to CordiaClassroom…" |
| CordiaClassroom | `extension/background.js:26, 70, 76, 211` | "Sign in to CordiaClassroom first." and similar error messages |
| CordiaClassroom | `extension/README.md:1, 3, 13, 38, 50, 57` | Extension README |
| AutoStudy | `extension/background.js:3`, `extension/asai-bridge.js:6`, `extension/README.md:61` | Backend host `autostudy-ai.fly.dev` (visible in extension source and network requests) |
| cordiacode | `web/pages/connect/claude.js:7` | MCP server URL shown to users: `https://classroom.cordiacode.com/mcp` |
| cordiacode | `web/lib/mcp/config.mjs:6` | OAuth token audience `https://classroom.cordiacode.com/mcp` |
| cordiacode | `docs/SUBMISSION.md:15, 46, 56, 57, 101, 110, 111, 116, 143, 157, 179, 190, 204, 225, 234` | Claude directory listing: server, docs, privacy and site URLs on the old domain |
| OpenAI, Groq | `web/pages/privacy.js:77` | "…Groq and OpenAI (AI content generation, image reading and speech-to-text)…". Anthropic isn't listed. |
| GPT-4o | – | none in user-facing copy (model IDs exist only in server code) |

**Code identifiers that matched but aren't copy:**
- `openAid` (`web/pages/guide/[id].js`)
- the `beta` filter parameter (`web/lib/airDraw.mjs`) and `event.beta` (`web/lib/ambientMotion.js`)
- `autostudy_*` storage keys (`web/pages/create.js:14, 16`)
- the `billing.unlimited` flag (`web/pages/learn/[guideId].js:228`, `web/pages/quiz/[guideId].js:105`)
- `SmartNotesPage` (`web/pages/smartnotes.js:50`)

---

## Method

1. **Visibility:** `gh api repos/CordiaAI/cordia-classroom`, plus an unauthenticated fetch of the repo page and `/issues`.
2. **Secrets:** fetched every branch and every `refs/pull/*/head` and unshallowed the clone. Ran gitleaks 8.21.2 (downloaded to a temporary folder, redacted output) and a redacted regex scan of `git log -p --all`.
3. **PRs and issues:** gh REST API for issues, PRs, issue and PR comments, review comments and reviews.
4. **Browser bundle:** traced which files read secrets and who imports them. Ran `next build`, then grepped `web/.next/static`.
5. **Domains:** `curl -sIL` per URL and scheme. The expired certificate was checked with `openssl s_client`.
6. **Pages:** `next build && next start`, then fetched each route's HTML with Python `urllib` (no JavaScript) and parsed the title, meta tags, canonical, OG, headings, JSON-LD and visible text. Repeated against production.
7. **Facts:** read from source. Key lines were re-checked by hand: entitlements, billing, terms, mission, popup, manifest, intervals, quiz types and Learn levels. The production guide visibility default and RLS policies were checked read-only.
8. **Copy sweep:** a regex sweep of the scoped folders, skipping comments and imports. Matches were sorted into copy and code identifiers by reading each line.
