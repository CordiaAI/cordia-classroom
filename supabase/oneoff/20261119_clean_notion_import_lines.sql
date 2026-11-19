-- NOT RUN: for Jude to review and run
--
-- What this does: guides that the first Notion import (F1) filed hold lines the import wrote about
-- itself as ordinary outline bullets: the "The rest of this Notion page wasn't imported because ..."
-- note, "Part of this Notion page couldn't be read ...", "Sub-page: <title>" and "Database: <title>".
-- Cards and quizzes made from those guides can be made from those lines. The code now keeps them out
-- of anything made from notes (text_processing._IMPORT_NOTE); this removes them from the stored
-- notes of guides already filed. It only touches study_guides.notes of rows whose external_source_id
-- starts with 'notion:' (the Notion imports), and only deletes whole lines that match.
--
-- Run PART 1 first (it reads only), look at the counts and the sample lines, then run PART 2.
-- Part 2 is one statement, so it either changes everything or nothing. Nothing else is changed
-- except connector_links.synced_hash of the rows it just cleaned, and only for guides the student had
-- not edited (the hash matched the old notes), so a later re-import still refreshes them.
--
-- Matching rules (same as the code): an optional list or heading mark ("- ", "* ", "• ", "1. ", "## "),
-- then one of the note sentences or "Sub-page: ". "Database: <title>" counts only with a "- ", "* ",
-- "• " or "#" mark, at most 100 characters, and not ending in . ! or ? (a sentence in a course's own
-- notes, like "- Database: a structured collection of data.", is kept).

-- ===== PART 1: read-only =====

-- How many guides and how many lines would change.
with lines as (
  select g.id, t.line
  from public.study_guides g,
       lateral regexp_split_to_table(g.notes, E'\n') as t(line)
  where g.external_source_id like 'notion:%' and g.notes is not null
), flagged as (
  select id, line from lines
  where btrim(line, E' \t\r') ~ '^(([-*•▪◦·]|[0-9]{1,2}[.)]|#{1,6})[[:space:]]+)?(The rest of this Notion page wasn''t imported because|Part of this Notion page couldn''t be read, so it isn''t all here|Sub-page: )'
     or (btrim(line, E' \t\r') ~ '^([-*•▪◦·]|#{1,6})[[:space:]]+Database: [^[:space:]].{0,99}$'
         and btrim(line, E' \t\r') !~ '[.!?]$')
)
select count(distinct id) as guides_to_clean, count(*) as lines_to_remove
from flagged;

-- The lines themselves, to read before you run Part 2 (first 200).
with lines as (
  select g.id, g.title, t.line
  from public.study_guides g,
       lateral regexp_split_to_table(g.notes, E'\n') as t(line)
  where g.external_source_id like 'notion:%' and g.notes is not null
)
select id, title, btrim(line, E' \t\r') as line_to_remove
from lines
where btrim(line, E' \t\r') ~ '^(([-*•▪◦·]|[0-9]{1,2}[.)]|#{1,6})[[:space:]]+)?(The rest of this Notion page wasn''t imported because|Part of this Notion page couldn''t be read, so it isn''t all here|Sub-page: )'
   or (btrim(line, E' \t\r') ~ '^([-*•▪◦·]|#{1,6})[[:space:]]+Database: [^[:space:]].{0,99}$'
       and btrim(line, E' \t\r') !~ '[.!?]$')
order by title, id
limit 200;

-- ===== PART 2: the change (run after reading Part 1) =====

with cleaned as (
  select g.id,
         g.notes as old_notes,
         coalesce((
           select string_agg(t.line, E'\n' order by t.ord)
           from regexp_split_to_table(g.notes, E'\n') with ordinality as t(line, ord)
           where not (
             btrim(t.line, E' \t\r') ~ '^(([-*•▪◦·]|[0-9]{1,2}[.)]|#{1,6})[[:space:]]+)?(The rest of this Notion page wasn''t imported because|Part of this Notion page couldn''t be read, so it isn''t all here|Sub-page: )'
             or (btrim(t.line, E' \t\r') ~ '^([-*•▪◦·]|#{1,6})[[:space:]]+Database: [^[:space:]].{0,99}$'
                 and btrim(t.line, E' \t\r') !~ '[.!?]$')
           )
         ), '') as new_notes
  from public.study_guides g
  where g.external_source_id like 'notion:%' and g.notes is not null
), changed as (
  select * from cleaned where new_notes is distinct from old_notes
), updated as (
  update public.study_guides s
     set notes = c.new_notes
    from changed c
   where s.id = c.id
  returning s.id, c.old_notes, c.new_notes
)
-- Keep "untouched by the student" true for the guides the student never edited.
update public.connector_links l
   set synced_hash = substr(encode(sha256(convert_to(u.new_notes, 'UTF8')), 'hex'), 1, 32)
  from updated u
 where l.cordia_id = u.id::text
   and l.connector = 'notion'
   and l.kind = 'file'
   and l.synced_hash = substr(encode(sha256(convert_to(u.old_notes, 'UTF8')), 'hex'), 1, 32);

-- Afterwards, Part 1's first query should return 0 and 0.
