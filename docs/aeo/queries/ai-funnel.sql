-- AI-referral funnel: sign-ups in the last 7 and 30 days by AI assistant and source, and how many
-- of them made a first guide, studied, started a trial and are paying.
--
-- Read-only (a single SELECT). Run it in the Supabase SQL editor, where auth.users is readable.
-- Needs user_profiles.acquisition (migration 20261129120000_user_profiles_acquisition.sql) and
-- only fills in for sign-ups after ACQUISITION_TRACKING was turned on; earlier sign-ups show as
-- "(not recorded)". Excludes the demo account and everyone in public.app_admins.
--
--   ai_engine  chatgpt, perplexity, gemini, copilot, claude or bing_chat (web/lib/attribution.mjs);
--              "(none)" when the first touch came from somewhere else.
--   source     utm_source, else the referring host, else "(direct)".
--   made_first_guide  made a guide of their own (copies of someone else's guide don't count).
--   studied           any Learn, Quiz or Flashcards activity: an answer in learning_events (Learn,
--                     flashcards and Study now log there), a quiz attempt, or a quiz or flashcard
--                     study session.
--   started_trial     started the no-card trial (user_subscriptions.pro_trial_started_at).
--   paying            a paid plan that is active or past_due (Stripe retrying a payment); a trial
--                     ("trialing") is not paying.
with excluded as (
  select 'd8084ee2-a763-469e-8c33-ace8203a80c4'::uuid as user_id
  union
  select user_id from public.app_admins
),
windows (period, days) as (values ('last 7 days', 7), ('last 30 days', 30)),
signups as (
  select u.id as user_id, u.created_at, p.acquisition
  from auth.users u
  left join public.user_profiles p on p.id = u.id
  where u.created_at >= now() - interval '30 days'
    and not exists (select 1 from excluded x where x.user_id = u.id)
),
cohort as (
  select w.period, w.days, s.user_id,
    coalesce(nullif(s.acquisition ->> 'ai_engine', ''),
      case when s.acquisition is null then '(not recorded)' else '(none)' end) as ai_engine,
    coalesce(nullif(s.acquisition ->> 'utm_source', ''), nullif(s.acquisition ->> 'referrer_host', ''),
      case when s.acquisition is null then '(not recorded)' else '(direct)' end) as source
  from signups s
  join windows w on s.created_at >= now() - make_interval(days => w.days)
),
flags as (
  select c.*,
    exists (select 1 from public.study_guides g
            where g.user_id = c.user_id and g.forked_from_guide_id is null) as made_first_guide,
    (exists (select 1 from public.learning_events e where e.user_id = c.user_id)
      or exists (select 1 from public.quiz_attempts q where q.user_id = c.user_id)
      or exists (select 1 from public.study_sessions ss
                 where ss.user_id = c.user_id and ss.session_type in ('quiz', 'flashcard'))) as studied,
    exists (select 1 from public.user_subscriptions t
            where t.user_id = c.user_id and t.pro_trial_started_at is not null) as started_trial,
    exists (select 1 from public.user_subscriptions t
            where t.user_id = c.user_id and t.status in ('active', 'past_due')
              and t.plan in ('classroom_pro', 'academic_weapon', 'pro', 'classroom_plus')) as paying
  from cohort c
)
select period, ai_engine, source,
  count(*) as signups,
  count(*) filter (where made_first_guide) as made_first_guide,
  count(*) filter (where studied) as studied,
  count(*) filter (where started_trial) as started_trial,
  count(*) filter (where paying) as paying
from flags
group by period, days, ai_engine, source
order by days, signups desc, ai_engine, source;
