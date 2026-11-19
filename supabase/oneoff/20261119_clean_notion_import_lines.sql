-- NOT RUN: for Jude to review and run
--
-- What this does. The first Notion import (F1, live from about 01:47 UTC on 19 Nov 2026 until the fix
-- in PR 285 went live) wrote lines about the import itself into the notes of the guides it filed, as
-- outline lines: "- Sub-page: <title>" and "- Database: <title>" (or "## ..." for a short title) and,
-- when it stopped early, one of three closing sentences ("- The rest of this Notion page wasn't
-- imported because ..."). This takes exactly those lines out of the stored notes of the guides that
-- import filed, and nothing else.
--
-- Which guides: study_guides rows whose external_source_id starts with 'notion:' AND that were made
-- (created_at) or re-imported (connector_links.updated_at) from f1_live up to fix_live (set below).
-- Guides from the Notion import before F1, from any other source, or made after the fix are never
-- touched.
--
-- Which lines: a whole line exactly as F1 wrote it (the same rule as
-- backend/services/text_processing.py is_f1_import_line; a test keeps the two in step):
--   * "- " followed by one of the three closing sentences, word for word;
--   * "- Sub-page: <title>" or "- Database: <title>";
--   * "## Sub-page: <title>" or "## Database: <title>" when "Sub-page: <title>" is 3 to 80 characters,
--     at most 10 words and doesn't end in , ; : ? or ! (the only headings F1's outline made of them).
--   A title that starts with a small letter or ends with a full stop reads as a definition
--   ("- Database: organized collection of related data", "- Database: a structured collection of
--   data.") and is kept. Indented lines, other list marks and lines with anything before them are kept.
--   Only whole matching lines change; every other line, blank lines included, stays exactly as it is.
--
-- HOW TO RUN (Supabase dashboard > SQL editor):
--   0. In BOTH parts, set fix_live to when the fix went live: the backend release that shipped PR 285
--      (`cd backend && fly releases`, in UTC). Left as now(), it also covers Notion guides made after
--      the fix, which can only hold real course lines.
--   1. Select Part 1 alone and run it. It only reads: every line that would be removed, with its guide,
--      when the guide was made or re-imported, and its line number. If one of them is the course's own
--      text (a Notion page whose own bullet is "- Database: Westlaw and LexisNexis"), put its
--      (guide_id, line_number) in Part 2's keep list.
--   2. Select Part 2 alone and run it as it is. It ends in ROLLBACK, so it changes nothing: the result
--      shows how many guides and lines it WOULD change. Check they match Part 1, less the keep list.
--   3. Only then change Part 2's last line from `rollback;` to `commit;` and run Part 2 again.
--   Pasting and running the whole file as it is changes nothing (Part 2 rolls back). Running Part 2
--   with commit a second time changes nothing (the lines are already gone).
--
-- connector_links.synced_hash is updated only for guides the student never edited (the hash matched
-- the old notes), so a later re-import still refreshes them; an edited guide keeps its old hash.

-- ===== PART 1: read-only. Every line that would be removed. =====

with settings as (
  select timestamptz '2026-11-19 01:45:00+00' as f1_live,
         now() as fix_live  -- set to when the fix went live, e.g. timestamptz '2026-11-20 18:00:00+00'
), f1_guides as (
  select g.id, g.title, g.notes, g.created_at, max(l.updated_at) as synced_at
  from public.study_guides g
  cross join settings s
  left join public.connector_links l on l.cordia_id = g.id::text and l.connector = 'notion' and l.kind = 'file'
  where g.external_source_id like 'notion:%' and g.notes is not null
  group by g.id, g.title, g.notes, g.created_at, s.f1_live, s.fix_live
  having (g.created_at >= s.f1_live and g.created_at < s.fix_live)
      or (max(l.updated_at) >= s.f1_live and max(l.updated_at) < s.fix_live)
), lines as (
  select f.id, f.title, f.created_at, f.synced_at, t.ord as line_number,
         rtrim(t.line, E' \t\r') as l,
         substring(rtrim(t.line, E' \t\r') from '^(?:- |## )(?:Sub-page|Database): (.*)$') as page_title
  from f1_guides f, regexp_split_to_table(f.notes, E'\n') with ordinality as t(line, ord)
), candidates as (
  select * from lines
  where l in ('- The rest of this Notion page wasn''t imported because Notion was slow to answer.',
              '- The rest of this Notion page wasn''t imported because the page is longer than Cordia reads at once.',
              '- Part of this Notion page couldn''t be read, so it isn''t all here.')
     or (page_title ~ '^[^[:space:]]' and page_title !~ '^[[:lower:]]' and page_title !~ '[.]$'
         and (l like '- %'
              or (length(substr(l, 4)) between 3 and 80
                  and array_length(regexp_split_to_array(substr(l, 4), '[[:space:]]+'), 1) <= 10
                  and l !~ '[,;:?!]$')))
)
select id as guide_id, title, created_at, synced_at, line_number, l as line_to_remove
from candidates
order by created_at, id, line_number;

-- ===== PART 2: the change. It ends in ROLLBACK; change that to COMMIT only after checking Part 1. =====

begin;

with settings as (
  select timestamptz '2026-11-19 01:45:00+00' as f1_live,
         now() as fix_live  -- set to when the fix went live, e.g. timestamptz '2026-11-20 18:00:00+00'
), keep (guide_id, line_number) as (
  -- Lines Part 1 listed that are the course's own text, as (guide_id, line_number) pairs. For example:
  -- values ('00000000-0000-4000-8000-000000000001'::uuid, 3::bigint), ('...'::uuid, 7::bigint)
  select null::uuid, null::bigint where false
), f1_guides as (
  select g.id, g.title, g.notes, g.created_at, max(l.updated_at) as synced_at
  from public.study_guides g
  cross join settings s
  left join public.connector_links l on l.cordia_id = g.id::text and l.connector = 'notion' and l.kind = 'file'
  where g.external_source_id like 'notion:%' and g.notes is not null
  group by g.id, g.title, g.notes, g.created_at, s.f1_live, s.fix_live
  having (g.created_at >= s.f1_live and g.created_at < s.fix_live)
      or (max(l.updated_at) >= s.f1_live and max(l.updated_at) < s.fix_live)
), lines as (
  select f.id, f.title, f.created_at, f.synced_at, t.ord as line_number,
         rtrim(t.line, E' \t\r') as l,
         substring(rtrim(t.line, E' \t\r') from '^(?:- |## )(?:Sub-page|Database): (.*)$') as page_title
  from f1_guides f, regexp_split_to_table(f.notes, E'\n') with ordinality as t(line, ord)
), candidates as (
  select * from lines
  where l in ('- The rest of this Notion page wasn''t imported because Notion was slow to answer.',
              '- The rest of this Notion page wasn''t imported because the page is longer than Cordia reads at once.',
              '- Part of this Notion page couldn''t be read, so it isn''t all here.')
     or (page_title ~ '^[^[:space:]]' and page_title !~ '^[[:lower:]]' and page_title !~ '[.]$'
         and (l like '- %'
              or (length(substr(l, 4)) between 3 and 80
                  and array_length(regexp_split_to_array(substr(l, 4), '[[:space:]]+'), 1) <= 10
                  and l !~ '[,;:?!]$')))
), removing as (
  select c.id, c.line_number from candidates c
  where not exists (select 1 from keep k where k.guide_id = c.id and k.line_number = c.line_number)
), cleaned as (
  select g.id, g.notes as old_notes,
         coalesce((select string_agg(t.line, E'\n' order by t.ord)
                     from regexp_split_to_table(g.notes, E'\n') with ordinality as t(line, ord)
                    where not exists (select 1 from removing r where r.id = g.id and r.line_number = t.ord)), '') as new_notes,
         (select count(*) from removing r where r.id = g.id) as lines_removed
  from public.study_guides g
  where g.id in (select id from removing)
), updated as (
  update public.study_guides s
     set notes = c.new_notes
    from cleaned c
   where s.id = c.id
  returning s.id, c.old_notes, c.new_notes, c.lines_removed
), rehashed as (
  -- Keep "untouched by the student" true for the guides the student never edited.
  update public.connector_links l
     set synced_hash = substr(encode(sha256(convert_to(u.new_notes, 'UTF8')), 'hex'), 1, 32)
    from updated u
   where l.cordia_id = u.id::text
     and l.connector = 'notion'
     and l.kind = 'file'
     and l.synced_hash = substr(encode(sha256(convert_to(u.old_notes, 'UTF8')), 'hex'), 1, 32)
  returning l.cordia_id
)
select (select count(*) from updated) as guides_changed,
       (select coalesce(sum(lines_removed), 0) from updated) as lines_removed,
       (select count(*) from rehashed) as hashes_updated;

-- Check guides_changed and lines_removed against Part 1, then change this line to: commit;
rollback;
