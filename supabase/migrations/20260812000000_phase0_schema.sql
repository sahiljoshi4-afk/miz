-- Phase 0: full §4.3 schema, owner-scoped RLS from the first migration.
create extension if not exists vector;

create table public.profile (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.view_share (
  grantor_id uuid not null references public.profile(id) on delete cascade,
  grantee_id uuid not null references public.profile(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  primary key (grantor_id, grantee_id)
);

create table public.dish (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profile(id) on delete cascade,
  canonical_name text,
  aliases text[] not null default '{}',
  cuisine text,
  sub_region text,
  first_cooked_at timestamptz,
  cook_count int not null default 0,
  avg_rating numeric(2,1),
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create table public.cook (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profile(id) on delete cascade,
  dish_id uuid references public.dish(id) on delete set null,
  cooked_at timestamptz not null default now(),
  note_raw text not null default '',
  extraction jsonb not null default '{}'::jsonb,
  rating smallint check (rating between 1 and 5),
  would_repeat boolean,
  effort_minutes int,
  servings int,
  occasion text,
  eaten_out boolean not null default false,
  venue text,
  source text,
  source_ref text,
  enrichment_status text not null default 'done' check (enrichment_status in ('queued','processing','done','failed','needs_review')),
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create table public.cook_participant (
  cook_id uuid not null references public.cook(id) on delete cascade,
  profile_id uuid not null references public.profile(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','co_author')),
  primary key (cook_id, profile_id)
);

create table public.photo (
  id uuid primary key default gen_random_uuid(),
  cook_id uuid not null references public.cook(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  phase text,
  is_cover boolean not null default true,
  exif jsonb
);

create table public.ingredient (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profile(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  category text
);

create table public.cook_ingredient (
  cook_id uuid not null references public.cook(id) on delete cascade,
  ingredient_id uuid not null references public.ingredient(id) on delete cascade,
  amount_text text,
  notes text,
  primary key (cook_id, ingredient_id)
);

create table public.technique (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profile(id) on delete cascade,
  name text not null,
  category text
);

create table public.cook_technique (
  cook_id uuid not null references public.cook(id) on delete cascade,
  technique_id uuid not null references public.technique(id) on delete cascade,
  primary key (cook_id, technique_id)
);

create table public.correction (
  id uuid primary key default gen_random_uuid(),
  cook_id uuid not null references public.cook(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profile(id) on delete cascade,
  field text not null,
  model_value text,
  my_value text,
  created_at timestamptz not null default now()
);

-- Photos live in a private bucket. Storage policies (below) scope reads to the owner.
insert into storage.buckets (id, name, public)
values ('cooks', 'cooks', false)
on conflict (id) do nothing;

-- ---- RLS predicates (§4.4) ----

create or replace function public.is_participant(c public.cook)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cook_participant cp
    where cp.cook_id = c.id and cp.profile_id = auth.uid()
  );
$$;

create or replace function public.can_view(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = owner
      or exists (
        select 1 from public.view_share vs
        where vs.grantor_id = owner
          and vs.grantee_id = auth.uid()
          and vs.status = 'accepted'
      );
$$;

-- ---- Policies ----

alter table public.profile enable row level security;
create policy profile_select on public.profile for select using (id = auth.uid());
create policy profile_insert on public.profile for insert with check (id = auth.uid());
create policy profile_update on public.profile for update using (id = auth.uid()) with check (id = auth.uid());

alter table public.view_share enable row level security;
create policy view_share_select on public.view_share for select
  using (grantor_id = auth.uid() or grantee_id = auth.uid());
create policy view_share_insert on public.view_share for insert with check (grantor_id = auth.uid());
create policy view_share_update on public.view_share for update
  using (grantor_id = auth.uid() or grantee_id = auth.uid());

alter table public.dish enable row level security;
create policy dish_select on public.dish for select using (public.can_view(owner_id));
create policy dish_insert on public.dish for insert with check (owner_id = auth.uid());
create policy dish_update on public.dish for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy dish_delete on public.dish for delete using (owner_id = auth.uid());

alter table public.ingredient enable row level security;
create policy ingredient_select on public.ingredient for select using (public.can_view(owner_id));
create policy ingredient_insert on public.ingredient for insert with check (owner_id = auth.uid());
create policy ingredient_update on public.ingredient for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ingredient_delete on public.ingredient for delete using (owner_id = auth.uid());

alter table public.technique enable row level security;
create policy technique_select on public.technique for select using (public.can_view(owner_id));
create policy technique_insert on public.technique for insert with check (owner_id = auth.uid());
create policy technique_update on public.technique for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy technique_delete on public.technique for delete using (owner_id = auth.uid());

alter table public.cook enable row level security;
create policy cook_select on public.cook for select
  using (public.is_participant(cook) or public.can_view(owner_id));
create policy cook_insert on public.cook for insert with check (owner_id = auth.uid());
create policy cook_update on public.cook for update using (public.is_participant(cook));
create policy cook_delete on public.cook for delete using (public.is_participant(cook));

alter table public.cook_participant enable row level security;
create policy cook_participant_select on public.cook_participant for select
  using (exists (
    select 1 from public.cook c
    where c.id = cook_participant.cook_id
      and (public.is_participant(c) or public.can_view(c.owner_id))
  ));
create policy cook_participant_insert on public.cook_participant for insert
  with check (exists (
    select 1 from public.cook c
    where c.id = cook_participant.cook_id
      and c.owner_id = auth.uid()
      and cook_participant.profile_id = auth.uid()
  ));
-- update/delete policies arrive with co-cooking (2b); nobody needs them in Phase 0.

alter table public.photo enable row level security;
create policy photo_select on public.photo for select using (exists (
  select 1 from public.cook c
  where c.id = photo.cook_id
    and (public.is_participant(c) or public.can_view(c.owner_id))
));
create policy photo_insert on public.photo for insert with check (exists (
  select 1 from public.cook c
  where c.id = photo.cook_id and c.owner_id = auth.uid()
));

alter table public.cook_ingredient enable row level security;
create policy cook_ingredient_select on public.cook_ingredient for select using (exists (
  select 1 from public.cook c
  where c.id = cook_ingredient.cook_id
    and (public.is_participant(c) or public.can_view(c.owner_id))
));
create policy cook_ingredient_insert on public.cook_ingredient for insert with check (exists (
  select 1 from public.cook c
  where c.id = cook_ingredient.cook_id and c.owner_id = auth.uid()
));

alter table public.cook_technique enable row level security;
create policy cook_technique_select on public.cook_technique for select using (exists (
  select 1 from public.cook c
  where c.id = cook_technique.cook_id
    and (public.is_participant(c) or public.can_view(c.owner_id))
));
create policy cook_technique_insert on public.cook_technique for insert with check (exists (
  select 1 from public.cook c
  where c.id = cook_technique.cook_id and c.owner_id = auth.uid()
));

alter table public.correction enable row level security;
create policy correction_select on public.correction for select using (exists (
  select 1 from public.cook c
  where c.id = correction.cook_id
    and (public.is_participant(c) or public.can_view(c.owner_id))
));
create policy correction_insert on public.correction for insert with check (exists (
  select 1 from public.cook c
  where c.id = correction.cook_id and c.owner_id = auth.uid()
));

-- Storage policies for the 'cooks' bucket are created via the Supabase dashboard
-- (Storage → cooks → Policies). Hosted Supabase forbids this DDL in migrations
-- (permission denied to set role). Migration 20260813000001 asserts they exist.

-- ---- Atomic server-side write path (used by the flush queue) ----
-- Runs with the caller's role, so RLS still applies. Idempotent: retry-safe.

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
  insert into public.photo (cook_id, storage_path, is_cover) values (p_cook_id, p_storage_path, true);
end;
$$;

grant execute on function public.create_cook(uuid, timestamptz, text, text) to authenticated;
