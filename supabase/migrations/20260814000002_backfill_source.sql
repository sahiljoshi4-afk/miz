-- Quiet backfill: source flag. Existing rows become 'own'; feeds exclude 'backfill'.
alter table public.cook alter column source set default 'own';
update public.cook set source = 'own' where source is null;

-- create_cook gains an optional source (default keeps existing callers working).
create or replace function public.create_cook(
  p_cook_id uuid,
  p_cooked_at timestamptz,
  p_note text,
  p_storage_path text,
  p_source text default 'own'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.cook where id = p_cook_id) then
    return;
  end if;
  insert into public.cook (id, cooked_at, note_raw, source) values (p_cook_id, p_cooked_at, p_note, p_source);
  insert into public.cook_participant (cook_id, profile_id) values (p_cook_id, auth.uid());
  if p_storage_path is not null then
    insert into public.photo (cook_id, storage_path, is_cover) values (p_cook_id, p_storage_path, true);
  end if;
end;
$$;

grant execute on function public.create_cook(uuid, timestamptz, text, text, text) to authenticated;
