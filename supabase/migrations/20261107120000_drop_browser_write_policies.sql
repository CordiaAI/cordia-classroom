-- NOT APPLIED: waiting for owner's OK. Run check 1 in docs/design/social-sharing-audit.md §8 first.
--
-- Social plan, before Stage 1: the browser must not write these tables directly. Every write goes
-- through FastAPI (service role), or through a SECURITY DEFINER function that checks the owner
-- (apply_study_progress / merge_study_progress, set_my_timezone).
--
-- 20260915035012_harden_classroom_rls.sql dropped these policies and is listed as applied, but the
-- live snapshot (supabase/schema/live-2026-11.sql) still shows them, so a signed-in browser can
-- still insert/update/delete its own rows with the publishable key and skip the backend's checks.
-- user_profiles keeps its own-row insert policy (tests/rls/oauth_lockdown_rls.sql expects it);
-- 20261107130000_profiles_blocks.sql limits which columns that insert may set.
--
-- Nothing in the web app writes these tables with the browser's token (it reads study_guides ids
-- and calls the SECURITY DEFINER RPCs above). Read policies are unchanged.

drop policy if exists "Users can insert own folders" on public.folders;
drop policy if exists "Users can update own folders" on public.folders;
drop policy if exists "Users can delete own folders" on public.folders;

drop policy if exists "Users can insert own guides" on public.study_guides;
drop policy if exists "Users can update own guides" on public.study_guides;
drop policy if exists "Users can delete own guides" on public.study_guides;

drop policy if exists "Users can insert own attempts" on public.quiz_attempts;
drop policy if exists "Users can update own attempts" on public.quiz_attempts;
drop policy if exists "Users can delete own attempts" on public.quiz_attempts;

drop policy if exists "Users can insert own sessions" on public.study_sessions;
drop policy if exists "Users can update own sessions" on public.study_sessions;
drop policy if exists "Users can delete own sessions" on public.study_sessions;

drop policy if exists "Users can insert own streaks" on public.user_streaks;
drop policy if exists "Users can update own streaks" on public.user_streaks;

-- Legacy and unused; table grants were already revoked (20260911000000), so these only tidy up.
drop policy if exists "Users can insert own usage" on public.monthly_usage;
drop policy if exists "Users can update own usage" on public.monthly_usage;

-- Check afterwards (expect no rows):
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public'
--     and tablename in ('folders','study_guides','quiz_attempts','study_sessions','user_streaks','monthly_usage')
--     and cmd in ('INSERT','UPDATE','DELETE');

-- Rollback (re-creates the browser write policies exactly as they are live today):
-- create policy "Users can insert own folders" on public.folders for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own folders" on public.folders for update to public using (auth.uid() = user_id);
-- create policy "Users can delete own folders" on public.folders for delete to public using (auth.uid() = user_id);
-- create policy "Users can insert own guides" on public.study_guides for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own guides" on public.study_guides for update to public using (auth.uid() = user_id);
-- create policy "Users can delete own guides" on public.study_guides for delete to public using (auth.uid() = user_id);
-- create policy "Users can insert own attempts" on public.quiz_attempts for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own attempts" on public.quiz_attempts for update to public using (auth.uid() = user_id);
-- create policy "Users can delete own attempts" on public.quiz_attempts for delete to public using (auth.uid() = user_id);
-- create policy "Users can insert own sessions" on public.study_sessions for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own sessions" on public.study_sessions for update to public using (auth.uid() = user_id);
-- create policy "Users can delete own sessions" on public.study_sessions for delete to public using (auth.uid() = user_id);
-- create policy "Users can insert own streaks" on public.user_streaks for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own streaks" on public.user_streaks for update to public using (auth.uid() = user_id);
-- create policy "Users can insert own usage" on public.monthly_usage for insert to public with check (auth.uid() = user_id);
-- create policy "Users can update own usage" on public.monthly_usage for update to public using (auth.uid() = user_id);
