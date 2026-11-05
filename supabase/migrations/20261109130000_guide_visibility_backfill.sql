-- NOT APPLIED: waiting for owner's OK. Data step for 20261109120000_guide_visibility.sql; run it
-- right after that file. Safe to run again.
--
-- Owner's decision (Stage 3): guides shared with a course stay course-only. Nothing becomes more
-- visible than it is today.
-- 1. A guide whose class set is shared with its course (shared_sets.visibility 'class', not
--    taken down or hidden) becomes visibility 'classroom', anonymous (class sets never showed a
--    username). A set held for review keeps its hold. The author sees a one-time note that they
--    can now make it public.
-- 2. A course whose instructor opted out (classes.sharing_blocked) keeps its guides private.
-- 3. Saved copies of class sets (study_guides.linked_set_id) record where they came from:
--    forked_from_guide_id is the set's guide, forked_from_version the version they saved.
-- 4. Every other guide stays private (the column default).

update public.study_guides g
set visibility = 'classroom',
    attribution = 'anonymous',
    visibility_migrated = true,
    review_status = case when s.status = 'held' then 'held' else g.review_status end,
    hold_reason = case when s.status = 'held' then coalesce(s.hold_reason, g.hold_reason) else g.hold_reason end
from public.shared_sets s
join public.classes c on c.id = s.class_id
where s.guide_id = g.id
  and s.visibility = 'class'
  and s.status in ('visible', 'held')
  and not c.sharing_blocked
  and g.visibility = 'private';

update public.study_guides g
set forked_from_guide_id = s.guide_id,
    forked_from_version = coalesce(g.linked_set_version, 1)
from public.shared_sets s
where g.linked_set_id = s.id
  and g.forked_from_guide_id is null
  and s.guide_id <> g.id;

-- Check afterwards:
--   select visibility, attribution, review_status, count(*) from public.study_guides group by 1, 2, 3;
--   -- only 'private' and 'classroom' rows; classroom count = class-shared visible/held sets
--   select count(*) from public.study_guides where linked_set_id is not null and forked_from_guide_id is null;  -- 0 unless a source guide was deleted

-- Rollback:
-- update public.study_guides set visibility = 'private', attribution = 'named', review_status = 'ok', hold_reason = null,
--   visibility_migrated = false where visibility_migrated;
-- update public.study_guides set forked_from_guide_id = null, forked_from_version = null where linked_set_id is not null;
