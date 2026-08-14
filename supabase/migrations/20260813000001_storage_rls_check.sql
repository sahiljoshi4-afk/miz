-- Assert the storage security posture we depend on: RLS on, and owner-scoped
-- policies on the cooks bucket for SELECT/INSERT/UPDATE. The policies are
-- created via the dashboard (see 001's comment); this verifies the rule's
-- substance, not its name — the dashboard auto-names policies.
do $$
declare
  rls_on boolean;
  owner_scoped int;
begin
  select relrowsecurity into rls_on
  from pg_class where oid = 'storage.objects'::regclass;
  select count(*) into owner_scoped
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('SELECT', 'INSERT', 'UPDATE')
    and position('bucket_id = ''cooks''' in coalesce(qual::text, '') || coalesce(with_check::text, '')) > 0
    and position('auth.uid()' in coalesce(qual::text, '') || coalesce(with_check::text, '')) > 0
    and position('storage.foldername(name)' in coalesce(qual::text, '') || coalesce(with_check::text, '')) > 0;
  if not rls_on or owner_scoped < 3 then
    raise exception 'storage check failed: rls_on=% owner_scoped_policies=%', rls_on, owner_scoped;
  end if;
end;
$$;
