-- Phase 1 slice 1: enrichment queue.
-- New cooks are queued for enrichment by default; existing rows (all 'done' so
-- far) are re-queued once so the sweep picks them up and backfills dish/cuisine.
alter table public.cook alter column enrichment_status set default 'queued';
update public.cook set enrichment_status = 'queued' where enrichment_status = 'done';
