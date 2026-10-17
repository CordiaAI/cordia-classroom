-- study_guides.domain was never set by any client (empty on all rows) and nothing reads it.
-- Apply only after the backend that stops selecting it is deployed.
alter table public.study_guides drop column if exists domain;
