-- Practice (/practice) and guide saves read/write study_guides.domain.
alter table public.study_guides add column if not exists domain text;
