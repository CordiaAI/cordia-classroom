-- Stage 7 (Discover) on a local Postgres with the Supabase stub: run after
-- 20261118120000_discover.sql and 20261118120001_discover_quality_fill.sql. Raises on any failure.
set client_min_messages = notice;
do $$
declare
  ana uuid := 'a0000000-0000-4000-8000-0000000000a1';
  ben uuid := 'a0000000-0000-4000-8000-0000000000b2';
  cat uuid := 'a0000000-0000-4000-8000-0000000000c3';
  g_osmo uuid := 'b0000000-0000-4000-8000-000000000001';
  g_cells uuid := 'b0000000-0000-4000-8000-000000000002';
  g_priv uuid := 'b0000000-0000-4000-8000-000000000003';
  g_held uuid := 'b0000000-0000-4000-8000-000000000004';
  n int; r record;
begin
  if has_function_privilege('authenticated', 'public.discover_guides(text,integer)', 'EXECUTE') then raise exception 'discover_guides is open to authenticated'; end if;
  if has_function_privilege('authenticated', 'public.is_verified_instructor(uuid)', 'EXECUTE') then raise exception 'is_verified_instructor is open to authenticated'; end if;
  if has_table_privilege('authenticated', 'public.guide_quality', 'SELECT') or has_table_privilege('anon', 'public.guide_quality', 'SELECT') then
    raise exception 'guide_quality is readable from the browser';
  end if;

  -- Ranking and exclusions.
  select count(*) into n from public.discover_guides('osmosis', 50);
  if n <> 1 then raise exception 'osmosis should match one public guide, got %', n; end if;
  select id into r from public.discover_guides('', 50) limit 1;
  select count(*) into n from public.discover_guides(null, 50) where id in (g_priv, g_held);
  if n <> 0 then raise exception 'private or held guides leaked into discover'; end if;
  select count(*) into n from public.discover_guides('cell', 50);
  if n <> 2 then raise exception 'cell should match both public cell guides, got %', n; end if;
  select id into r from public.discover_guides('cell membrane', 50) limit 1;
  if r.id <> g_cells then raise exception 'the title match should rank first'; end if;

  -- Quality.
  select * into r from public.guide_quality where guide_id = g_osmo;
  if r.studied_by <> 2 then raise exception 'studied_by should be 2 (one set studier, one progress row; owner left out), got %', r.studied_by; end if;
  if abs(r.mastery - 0.5) > 0.001 then raise exception 'mastery should be 0.5, got %', r.mastery; end if;
  if r.retention_7d <> 1 then raise exception 'retention should be 1, got %', r.retention_7d; end if;
  if r.reports <> 1 then raise exception 'reports should count one open report, got %', r.reports; end if;
  if not r.verified_instructor then raise exception 'ana confirmed her school email: verified'; end if;
  select * into r from public.guide_quality where guide_id = g_cells;
  if r.verified_instructor then raise exception 'ben never verified'; end if;
  select count(*) into n from public.guide_quality where guide_id in (g_priv, g_held);
  if n <> 0 then raise exception 'guide_quality lists private or held guides'; end if;
  raise notice 'DISCOVER CHECKS OK';
end $$;
