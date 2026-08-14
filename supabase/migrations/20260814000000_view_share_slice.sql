-- Phase 2b slice: profile lookup for sharing, display-name backfill,
-- and grantee-side delete (ignore) on view_share.

-- Map an email to a profile id + name, for the share-by-email step.
-- Security definer: only exposes id/display_name for an email that exists
-- in auth.users; the allowlist still gates who can use the app at all.
create or replace function public.lookup_profile(p_email text)
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id, p.display_name
  from auth.users u
  left join public.profile p on p.id = u.id
  where u.email = lower(p_email)
$$;

grant execute on function public.lookup_profile(text) to authenticated;

-- Display names for existing profiles (created before display-name support).
update public.profile p
set display_name = split_part(u.email, '@', 1)
from auth.users u
where p.id = u.id and p.display_name is null;

-- Both sides may delete a share (grantor revokes, grantee ignores).
create policy view_share_delete on public.view_share for delete
  using (grantor_id = auth.uid() or grantee_id = auth.uid());

-- Sharing participants may read each other's profile row (name for the
-- header toggle / pending banner). Select policies OR together, so the
-- existing profile_select (id = auth.uid()) still governs strangers.
create policy profile_read_shared on public.profile for select
  using (id = auth.uid() or exists (
    select 1 from public.view_share vs
    where (vs.grantor_id = auth.uid() and vs.grantee_id = profile.id)
       or (vs.grantee_id = auth.uid() and vs.grantor_id = profile.id)
  ));
