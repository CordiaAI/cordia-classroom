# Acquisition queries

Read-only SQL for the AI-referral funnel. Run these in the Supabase SQL editor, where `auth.users` can be read. Every query here is a single `SELECT` and changes nothing.

## When tracking went live

First-touch attribution went live on **2026-11-09**. That's the day the `user_profiles.acquisition` migration was applied and `ACQUISITION_TRACKING=1` was set on the backend.

The first backend deploy that day ran from code without the `acquisition` field on `POST /auth/age`. Sign-ups before the redeploy that includes it were saved without first-touch data. Use that redeploy's time as `go_live` below. You can confirm it's live when `https://autostudy-ai.fly.dev/openapi.json` lists `acquisition` under `AgeRequest`.

**`ai-funnel.sql` is only meaningful from that date onward.** Earlier sign-ups have no acquisition data and show as "(not recorded)". A 30-day window that starts before go-live mixes the two, so read it as a full picture only from 2026-12-09.

## Files

- `ai-funnel.sql`: sign-ups in the last 7 and 30 days by AI assistant and source. For each group it also counts who made a first guide, studied, started a trial, and is paying.

## 48-hour check: are new sign-ups getting acquisition data?

Run this 48 hours after go-live. Set `go_live` to the time of the deploy that accepts `acquisition`, in UTC.

```sql
with go_live as (select timestamptz '2026-11-09 00:00:00+00' as at),  -- set to the go-live deploy time
excluded as (
  select 'd8084ee2-a763-469e-8c33-ace8203a80c4'::uuid as id
  union select user_id from public.app_admins
),
new_users as (
  select u.id from auth.users u cross join go_live g
  where u.created_at >= g.at and u.id not in (select id from excluded)
)
select count(*) as signups,
       count(p.birth_month) as finished_age_step,
       count(p.acquisition) as with_acquisition,
       round(100.0 * count(p.acquisition) / nullif(count(p.birth_month), 0), 1) as pct_of_age_step,
       count(*) filter (where p.acquisition->>'ai_engine' is not null) as from_ai_assistant
from new_users n left join public.user_profiles p on p.id = n.id;
```

How to read it:

- **`with_acquisition` above 0:** the whole path works: browser, sign-up, backend, column.
- **`with_acquisition` at 0 while `finished_age_step` is above 0:** check that `openapi.json` lists `acquisition`, that `ACQUISITION_TRACKING` is on in Fly, and `cd backend && fly logs` for "First-touch attribution not saved".
- **Don't expect 100%.** The data is sent only at the age step of sign-up, and only from a browser that recorded a first touch. That means a visit to a public page while signed out in the last 30 days, with storage allowed.
