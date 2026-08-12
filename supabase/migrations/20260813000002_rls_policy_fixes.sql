-- Review fixes (2026-08-13): close two RLS escalation holes.
-- (1) view_share: a grantee could flip a pending share into an accepted share
--     from ANY grantor via the implicit WITH CHECK — grantor_id must be immutable.
-- (2) cook: a co-author could reassign owner_id to themselves, then add
--     participants, expanding readership beyond the owner's intent.
-- WITH CHECK expressions cannot reference the old row, so immutability is
-- enforced with BEFORE UPDATE triggers.

create or replace function public.enforce_view_share_grantor_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.grantor_id is distinct from old.grantor_id then
    raise exception 'grantor_id of a view_share cannot change';
  end if;
  return new;
end;
$$;

create trigger view_share_grantor_immutable
before update on public.view_share
for each row execute function public.enforce_view_share_grantor_immutable();

create or replace function public.enforce_cook_owner_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id of a cook cannot change';
  end if;
  return new;
end;
$$;

create trigger cook_owner_immutable
before update on public.cook
for each row execute function public.enforce_cook_owner_immutable();
