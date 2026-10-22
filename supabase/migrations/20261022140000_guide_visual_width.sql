-- Kept Outline visuals can be resized (NOT APPLIED: waiting for the owner's OK).
-- The width a student drags a visual to, as a % of the column beside the outline (30-100); null is
-- the default fit. Until this runs, widths are kept in the student's browser (OutlineVisuals.js).
alter table public.guide_visuals add column if not exists width smallint check (width between 30 and 100);
