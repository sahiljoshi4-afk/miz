-- Note-only cooks: create_cook accepts a null storage path (no photo row).

create or replace function public.create_cook(
  p_cook_id uuid,
  p_cooked_at timestamptz,
  p_note text,
  p_storage_path text
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
  insert into public.cook (id, cooked_at, note_raw) values (p_cook_id, p_cooked_at, p_note);
  insert into public.cook_participant (cook_id, profile_id) values (p_cook_id, auth.uid());
  if p_storage_path is not null then
    insert into public.photo (cook_id, storage_path, is_cover) values (p_cook_id, p_storage_path, true);
  end if;
end;
$$;

grant execute on function public.create_cook(uuid, timestamptz, text, text) to authenticated;
