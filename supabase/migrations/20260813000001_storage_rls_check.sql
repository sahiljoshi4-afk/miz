-- Assert the storage security posture we depend on: RLS on, and the three
-- cooks-bucket policies present.
do $$
declare
  rls_on boolean;
  n int;
begin
  select relrowsecurity into rls_on
  from pg_class where oid = 'storage.objects'::regclass;
  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('cooks_bucket_read', 'cooks_bucket_insert', 'cooks_bucket_update');
  if not rls_on or n < 3 then
    raise exception 'storage check failed: rls_on=% policies=%', rls_on, n;
  end if;
end;
$$;
