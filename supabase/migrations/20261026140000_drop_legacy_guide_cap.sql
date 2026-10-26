-- Drop the legacy 5-guide lifetime cap on free accounts (NOT APPLIED: waiting for the owner's OK).
--
-- enforce_free_guide_creation_limit (a BEFORE INSERT trigger on study_guides, created outside
-- these migrations) counts every new guide in free_plan_usage and raises CORDIA_FREE_GUIDE_LIMIT
-- after 5. Free limits moved to usage_ledger in 20261001120000_pro_entitlements.sql, which says
-- free_plan_usage is no longer read, but the trigger still fires: once a free student has 5
-- guides, every new one fails with a server error. That includes opening an older note, which
-- moves it into a guide, so those notes showed "Classroom hit a temporary problem".
--
-- AI guide generation is still limited per month by usage_ledger in the backend. free_plan_usage
-- is left in place (the entitlements migration drops it later).

drop trigger if exists enforce_free_guide_creation_limit on public.study_guides;
drop function if exists public.enforce_free_guide_creation_limit();
