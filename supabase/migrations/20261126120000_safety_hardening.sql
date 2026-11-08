-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 9: safety hardening.
--
-- 1. Reports cover guides, profiles and classrooms (shared_set_reports.target_type / target_id).
--    set_id stays for reports filed from a class set and becomes optional. New reason 'harassment'
--    (shown as "Harassment or impersonation"). One report per person per target.
--    Existing rows get their target in the separate backfill 20261126120100.
-- 2. Profiles and classrooms can be held for review or hidden (review_status, hold_reason), like
--    guides. A held item is hidden everywhere except from its owner (and a classroom's staff).
-- 3. hold_reported_target(): 3 or more different people with open reports hold the target at once.
--    The backend (services/reports.py) does the same, so the rule holds even without this trigger.
-- 4. user_profiles.birth_month: the first day of the birth month from sign-up (month and year only;
--    nothing finer is ever stored). Under 13 never gets an account; 13-17 counts as a minor.
-- 5. copyright_takedowns.profile_id: a takedown that names a profile (/u/<username>).
--
-- Until this is applied the backend keeps working: profile and classroom reports answer "isn't
-- available yet", set reports keep the old path, and no one is held by profile or classroom.
--
-- Check afterwards:
--   select column_name from information_schema.columns where table_name = 'shared_set_reports'
--    and column_name in ('target_type', 'target_id');                                        -- 2 rows
--   select column_name from information_schema.columns where table_name = 'user_profiles'
--    and column_name in ('review_status', 'hold_reason', 'birth_month');                     -- 3 rows
--   select column_name from information_schema.columns where table_name = 'classrooms'
--    and column_name in ('review_status', 'hold_reason');                                    -- 2 rows
--   select tgname from pg_trigger where tgname = 'shared_set_reports_hold_target';           -- 1 row
--
-- Rollback:
-- drop trigger if exists shared_set_reports_hold_target on public.shared_set_reports;
-- drop function if exists public.hold_reported_target();
-- alter table public.copyright_takedowns drop column if exists profile_id;
-- alter table public.classrooms drop column if exists review_status, drop column if exists hold_reason;
-- alter table public.user_profiles drop column if exists review_status, drop column if exists hold_reason,
--   drop column if exists birth_month;
-- drop index if exists public.shared_set_reports_target_reporter_key;
-- drop index if exists public.shared_set_reports_reporter_day_idx;
-- delete from public.shared_set_reports where set_id is null;      -- profile/classroom/guide-only reports
-- alter table public.shared_set_reports drop constraint if exists shared_set_reports_reason_check;
-- update public.shared_set_reports set reason = 'inappropriate' where reason = 'harassment';
-- alter table public.shared_set_reports add constraint shared_set_reports_reason_check
--   check (reason in ('wrong', 'copied_exam', 'copyright', 'inappropriate'));
-- alter table public.shared_set_reports drop constraint if exists shared_set_reports_target_check;
-- alter table public.shared_set_reports drop column if exists target_type, drop column if exists target_id;
-- alter table public.shared_set_reports alter column set_id set not null;

-- 1. Reports on any target ---------------------------------------------------------------------
alter table public.shared_set_reports
  add column if not exists target_type text,
  add column if not exists target_id uuid;
alter table public.shared_set_reports alter column set_id drop not null;

alter table public.shared_set_reports drop constraint if exists shared_set_reports_reason_check;
alter table public.shared_set_reports add constraint shared_set_reports_reason_check
  check (reason in ('wrong', 'copied_exam', 'copyright', 'inappropriate', 'harassment'));

-- A row names a target (new reports), a set (reports from before the backfill), or both.
alter table public.shared_set_reports drop constraint if exists shared_set_reports_target_check;
alter table public.shared_set_reports add constraint shared_set_reports_target_check check (
  (target_type is null and target_id is null and set_id is not null)
  or (target_type in ('guide', 'profile', 'classroom') and target_id is not null));

create unique index if not exists shared_set_reports_target_reporter_key
  on public.shared_set_reports (target_type, target_id, reporter_id) where target_type is not null;
-- "Reports today" for the 20-a-day limit.
create index if not exists shared_set_reports_reporter_day_idx on public.shared_set_reports (reporter_id, created_at);

-- 2. Held profiles and classrooms ---------------------------------------------------------------
alter table public.user_profiles
  add column if not exists review_status text not null default 'ok',
  add column if not exists hold_reason text,
  add column if not exists birth_month date;
alter table public.user_profiles drop constraint if exists user_profiles_review_status_check;
alter table public.user_profiles add constraint user_profiles_review_status_check check (review_status in ('ok', 'held', 'hidden'));
alter table public.user_profiles drop constraint if exists user_profiles_birth_month_check;
alter table public.user_profiles add constraint user_profiles_birth_month_check
  check (birth_month is null or (extract(day from birth_month) = 1 and birth_month >= date '1900-01-01'));

alter table public.classrooms
  add column if not exists review_status text not null default 'ok',
  add column if not exists hold_reason text;
alter table public.classrooms drop constraint if exists classrooms_review_status_check;
alter table public.classrooms add constraint classrooms_review_status_check check (review_status in ('ok', 'held', 'hidden'));

-- 3. Three different reporters hold the target -------------------------------------------------
create or replace function public.hold_reported_target()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.target_type is null or new.status <> 'open' then
    return new;
  end if;
  if (select count(distinct reporter_id) from public.shared_set_reports
      where target_type = new.target_type and target_id = new.target_id and status = 'open') < 3 then
    return new;
  end if;
  if new.target_type = 'guide' then
    update public.study_guides set review_status = 'held', hold_reason = 'Reported by 3 people'
      where id = new.target_id and review_status = 'ok';
    update public.shared_sets set status = 'hidden', updated_at = now()
      where guide_id = new.target_id and status = 'visible';
  elsif new.target_type = 'profile' then
    update public.user_profiles set review_status = 'held', hold_reason = 'Reported by 3 people'
      where id = new.target_id and review_status = 'ok';
  else
    update public.classrooms set review_status = 'held', hold_reason = 'Reported by 3 people'
      where id = new.target_id and review_status = 'ok';
  end if;
  return new;
end
$$;
revoke execute on function public.hold_reported_target() from public, anon, authenticated;
drop trigger if exists shared_set_reports_hold_target on public.shared_set_reports;
create trigger shared_set_reports_hold_target after insert on public.shared_set_reports
for each row execute function public.hold_reported_target();

-- 5. Takedowns that name a profile --------------------------------------------------------------
alter table public.copyright_takedowns
  add column if not exists profile_id uuid references auth.users(id) on delete set null;
