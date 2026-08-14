-- Phase 1 slice 1.5: display tags derived from extraction ingredients,
-- and re-queue already-enriched cooks so the next sweep re-enriches them
-- with the new schema (cleaned_note + tags).
alter table public.cook add column tags text[] not null default '{}';
update public.cook set enrichment_status = 'queued' where enrichment_status = 'done';
