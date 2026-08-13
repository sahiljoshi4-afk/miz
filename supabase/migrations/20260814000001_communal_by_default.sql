-- Communal-by-default (human directive, 2026-08-14): any registered member
-- (has a profile row) may read any log. Ownership/write RLS is unchanged --
-- this only widens the READ predicate. view_share stays for future opt-outs.
create or replace function public.can_view(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profile p where p.id = auth.uid()
  );
$$;

-- Every member, for the header selector. Invite-only app (allowlist gates
-- sign-in), so this exposes only id + display_name to members.
create or replace function public.list_profiles()
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name from public.profile p order by p.display_name nulls last;
$$;

grant execute on function public.list_profiles() to authenticated;
