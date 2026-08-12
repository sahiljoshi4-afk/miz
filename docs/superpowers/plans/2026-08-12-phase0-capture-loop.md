# Phase 0 Capture Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable iOS PWA where Sahil can sign in with a magic link, take a photo, add a note, and see it on his private feed — with every row owner-scoped and RLS-protected from the first migration, and offline saves surviving in IndexedDB.

**Architecture:** Next.js App Router on Vercel; Supabase (hosted) for Postgres + Storage + Auth. Capture writes to a Dexie queue before the network; a background flush uploads the photo and inserts `cook` + `photo` + `cook_participant` rows atomically via an RPC, all gated by RLS. Feed is server-rendered with 7-day signed photo URLs, updated optimistically client-side.

**Tech Stack:** Next.js (latest, App Router), TypeScript strict, Tailwind v4, Supabase (`@supabase/ssr`, `supabase-js`), Dexie, @tanstack/react-query, Vitest, Vercel CLI.

**Design spec:** `docs/superpowers/specs/2026-08-12-phase0-capture-loop-design.md` — read it first.

## Global Constraints

- Capture flow under 20 seconds from unlock to phone in pocket; save tap → back on feed < 300ms (optimistic, never a spinner).
- Design tokens ONLY: `--ink: #14150F`, `--paper: #EDEEEA`, `--graphite: #6B6D64`, `--hairline: #D6D7D1`. No accent colours in chrome. Fonts: Bricolage Grotesque (display), Inter Tight (UI), IBM Plex Mono (data — dates, counts).
- No custom camera UI — `<input type="file" accept="image/*" capture="environment">`. No modals in the capture path. No required fields (photo-only and note-only entries are valid). All primary actions in the bottom third of the screen, ≥56px tap targets.
- RLS on every table from the first migration. Never disable it. Never reach the DB with the service-role key from any client-touchable code path. `owner_id` always defaults from `auth.uid()` — the client never asserts identity.
- Capture writes to IndexedDB before touching the network (rule #2). A save must succeed in airplane mode.
- No view-shares, co-cooking, invite-flow, settings screen, AI, enrichment, or Realtime in Phase 0 (tables/policies for the first two exist; UI does not).
- No `next-pwa`. Hand-rolled service worker per spec.
- `npm run build` must pass before every commit that touches app code, and before every deploy.
- Phone-tested on iOS, not just simulators. Desktop/Android unoptimised is fine.

---

### Task 1: Scaffold Next.js app into miz

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`-equivalent (via create-next-app), `src/app/…` scaffold, `.gitignore`
- Move: `cooking-log-spec.md` → `docs/spec.md` (CLAUDE.md points at `docs/spec.md`; this fixes the stale pointer)

**Interfaces:**
- Produces: working `npm run dev` / `npm run build` baseline; repo has git (already initialised) and ignores `.env*`.

- [ ] **Step 1: Scaffold in a temp dir (outside the repo)**

```bash
cd /tmp
npx create-next-app@latest mise-scaffold \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --yes
```

- [ ] **Step 2: Move scaffold into miz, drop its git**

```bash
cd "/Users/sahilsmac/Documents/Claude code projects/miz"
rm -rf /tmp/mise-scaffold/.git
shopt -s dotglob && mv /tmp/mise-scaffold/* . && shopt -u dotglob
rmdir /tmp/mise-scaffold
```

- [ ] **Step 3: Move the product spec to where CLAUDE.md points**

```bash
mkdir -p docs && git mv cooking-log-spec.md docs/spec.md
```

- [ ] **Step 4: Install dependencies**

```bash
npm i @supabase/supabase-js @supabase/ssr dexie @tanstack/react-query
npm i -D supabase vitest fake-indexeddb
```

- [ ] **Step 5: Add test script** — in `package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 6: Verify build**

Run: `npm run build` — Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app, deps, move spec to docs/spec.md"
```

---

### Task 2: Supabase project + migration 001 (full schema, RLS, storage)

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20260812000000_phase0_schema.sql`
- Create: `.env.example`

**Interfaces:**
- Produces: hosted Supabase project linked; migration applied; `storage.cooks` bucket with owner-only policies; RPC `create_cook(uuid, timestamptz, text, text)` used by Task 4.

**Prereq (user action):** Sahil creates the hosted project at supabase.com (we agreed hosted, not local). Get from him: **project ref** (e.g. `abc123xyz`), **database password** (set in dashboard), **Project URL**, **anon key**. Put URL/anon key in `.env.local` now.

- [ ] **Step 1: Get Supabase credentials from Sahil**

Ask for: project ref, database password, Project URL, anon public key. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=<project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
ALLOWED_EMAILS=<sahil's email>
```

Create `.env.example` with the same keys, values blank.

- [ ] **Step 2: Init + link Supabase CLI**

```bash
npx supabase init
npx supabase link --project-ref <project-ref>   # prompts for the db password
```

- [ ] **Step 3: Configure auth redirects** — in `supabase/config.toml` under `[auth]`:

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
```

- [ ] **Step 4: Write the migration**

`supabase/migrations/20260812000000_phase0_schema.sql`:

```sql
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

-- Storage: only the folder owner can read/write `cooks/{owner_id}/{cook_id}/1.jpg`.
alter table storage.objects enable row level security;
create policy cooks_bucket_read on storage.objects for select
  using (bucket_id = 'cooks' and auth.uid()::text = (storage.foldername(name))[1]);
create policy cooks_bucket_insert on storage.objects for insert
  with check (bucket_id = 'cooks' and auth.uid()::text = (storage.foldername(name))[1]);
create policy cooks_bucket_update on storage.objects for update
  using (bucket_id = 'cooks' and auth.uid()::text = (storage.foldername(name))[1]);

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
```

- [ ] **Step 5: Apply it**

Run: `npx supabase db push` — Expected: applied cleanly, no errors.

- [ ] **Step 6: Push auth config**

Run: `npx supabase config push` — Expected: succeeds (sets the localhost redirect).

- [ ] **Step 7: Verify from the dashboard** — in Supabase → Table Editor: all 11 tables exist; Auth → Policies: each table shows `RLS enabled`. Storage → buckets: `cooks` exists, private.

- [ ] **Step 8: Commit**

```bash
git add supabase/ .env.example && git commit -m "feat: migration 001 — full schema, owner-scoped RLS, private photo bucket"
```

---

### Task 3: Auth — magic link, allowlist, profile

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/auth.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: env vars from Task 2's `.env.local`; migration 001 (`profile` insert policy).
- Produces (used by Task 5): `createClient()` (browser), `createServerClient()` (server, async), `isAllowedEmail(email: string | undefined): boolean`, `ensureProfile(supabase): Promise<void>`.

- [ ] **Step 1: Browser client** — `src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 2: Server client** — `src/lib/supabase/server.ts`

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes sessions.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 3: Allowlist + profile helpers** — `src/lib/auth.ts`

```ts
const allowed = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function isAllowedEmail(email: string | undefined): boolean {
  return !!email && allowed.includes(email.toLowerCase())
}
```

`ensureProfile` lives here too but needs the server client type — add it in Step 7 with the page.

- [ ] **Step 4: Middleware** — `src/middleware.ts` (session refresh; standard @supabase/ssr pattern)

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 5: Magic-link callback** — `src/app/auth/callback/route.ts`

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data } = await supabase.auth.getUser()
      if (isAllowedEmail(data.user?.email)) {
        return NextResponse.redirect(`${origin}/`)
      }
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?reason=not-invited`)
    }
  }
  return NextResponse.redirect(`${origin}/login?reason=error`)
}
```

- [ ] **Step 6: Login page** — `src/app/login/page.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const reason = useSearchParams().get('reason')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setBusy(false)
    if (!error) setSent(true)
  }

  return (
    <main className="flex min-h-dvh flex-col justify-between bg-paper p-6">
      <h1 className="font-display text-3xl text-ink">Mise</h1>
      {reason === 'not-invited' && (
        <p className="text-graphite">This email isn&apos;t on the list yet.</p>
      )}
      {sent ? (
        <p className="text-ink">Check your email — the link opens your log.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="email" className="sr-only">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-14 rounded-none border border-hairline bg-transparent px-4 text-lg text-ink placeholder:text-graphite"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-14 bg-ink text-paper disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Root page with auth gate + ensureProfile** — `src/app/page.tsx`

```tsx
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'

export default async function Home() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)
  // Task 5 fills in the feed here.
  return <main className="min-h-dvh bg-paper" />
}
```

Add `ensureProfile` to `src/lib/auth.ts` now (Task 5 imports it from there):

```ts
// src/lib/auth.ts (append)
import { createServerClient } from '@/lib/supabase/server'

export async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<void> {
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    await supabase
      .from('profile')
      .insert({ id: data.user.id }, { onConflict: 'id', ignoreDuplicates: true })
  }
}
```

- [ ] **Step 8: Wire design tokens now** — replace `src/app/globals.css`:

```css
@import 'tailwindcss';

@theme {
  --color-ink: #14150f;
  --color-paper: #edeeea;
  --color-graphite: #6b6d64;
  --color-hairline: #d6d7d1;
}

body {
  background: var(--color-paper);
  color: var(--color-ink);
}
```

(Fonts arrive in Task 5's layout step; the login page uses `font-display` which needs the font to exist — if `font-display` is undefined at this point, the build still passes but the class is inert. Acceptable until Task 5.)

- [ ] **Step 9: Verify build + manual login flow**

Run: `npm run build` — Expected: passes.
Run: `npm run dev`, open `http://localhost:3000` — Expected: redirected to `/login`; enter Sahil's email; magic link arrives; click it; lands on `/` with a paper screen. Entering a non-allowlisted email → magic link → `not-invited` state.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: magic-link auth with allowlist, session middleware, ensureProfile"
```

---

### Task 4: Dexie pending queue + flush (TDD)

**Files:**
- Create: `src/lib/db.ts`, `src/lib/queue.ts`
- Test: `src/lib/queue.test.ts`

**Interfaces:**
- Consumes: RPC `create_cook` + storage bucket `cooks` from Task 2.
- Produces (used by Task 5):
  - `db` (Dexie instance, table `pendingCooks`)
  - `interface PendingCook { id: string; photoBlob: Blob; note: string; cookedAt: string; status: 'draft' | 'ready' }`
  - `createDraft(photoBlob: Blob): Promise<string>` — persists a `draft`, returns id
  - `getDraft(id: string): Promise<PendingCook | undefined>`
  - `saveDraft(id: string, note: string): Promise<void>` — sets note, status `ready`
  - `pendingItems(): Promise<PendingCook[]>` — all `ready` rows
  - `flushPending(client: SupabaseClient): Promise<number>` — uploads + RPC + deletes; returns count flushed

- [ ] **Step 1: Write the failing test** — `src/lib/queue.test.ts`

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { db } from './db'
import { flushPending } from './queue'

function mockClient(overrides: Partial<SupabaseClient> = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-1' } } }) },
    storage: {
      from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }),
    },
    rpc: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  } as unknown as SupabaseClient
}

beforeEach(async () => {
  await db.pendingCooks.clear()
})

describe('flushPending', () => {
  it('uploads, calls create_cook, and removes the row on success', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: 'dal', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient()
    const flushed = await flushPending(client)
    expect(flushed).toBe(1)
    expect(client.storage.from).toHaveBeenCalledWith('cooks')
    expect(client.rpc).toHaveBeenCalledWith('create_cook', {
      p_cook_id: 'cook-1',
      p_cooked_at: '2026-08-12T19:00:00Z',
      p_note: 'dal',
      p_storage_path: 'owner-1/cook-1/1.jpg',
    })
    expect(await db.pendingCooks.count()).toBe(0)
  })

  it('does nothing when there is no session', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    expect(await flushPending(client)).toBe(0)
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('keeps the row when upload fails', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ error: { message: 'offline' } }),
        }),
      },
    })
    expect(await flushPending(client)).toBe(0)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('keeps the row when the rpc fails (retry is idempotent)', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      rpc: vi.fn().mockResolvedValue({ error: { message: 'network' } }),
    })
    expect(await flushPending(client)).toBe(0)
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('skips draft rows', async () => {
    await db.pendingCooks.add({
      id: 'cook-2', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'draft',
    })
    expect(await flushPending(mockClient())).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm test` — Expected: FAIL (module `./db` not found).

- [ ] **Step 3: Implement the Dexie schema** — `src/lib/db.ts`

```ts
import Dexie, { type Table } from 'dexie'

export interface PendingCook {
  id: string
  photoBlob: Blob
  note: string
  cookedAt: string // ISO timestamp of capture
  status: 'draft' | 'ready'
}

class MiseDB extends Dexie {
  pendingCooks!: Table<PendingCook, string>

  constructor() {
    super('mise')
    this.version(1).stores({ pendingCooks: 'id, status' })
  }
}

export const db = new MiseDB()

export async function createDraft(photoBlob: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await db.pendingCooks.add({
    id,
    photoBlob,
    note: '',
    cookedAt: new Date().toISOString(),
    status: 'draft',
  })
  return id
}

export async function getDraft(id: string): Promise<PendingCook | undefined> {
  return db.pendingCooks.get(id)
}

export async function saveDraft(id: string, note: string): Promise<void> {
  await db.pendingCooks.update(id, { note, status: 'ready' })
}

export async function pendingItems(): Promise<PendingCook[]> {
  return db.pendingCooks.where('status').equals('ready').toArray()
}
```

- [ ] **Step 4: Implement the flush** — `src/lib/queue.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { pendingItems, db } from './db'

export const COOKS_BUCKET = 'cooks'

export function cookPhotoPath(ownerId: string, cookId: string): string {
  return `${ownerId}/${cookId}/1.jpg`
}

// ponytail: flush runs on app open and after each save — per-cook retry state is overkill
// until there are many pending rows; add a retry counter column if flushes start failing silently.
export async function flushPending(client: SupabaseClient): Promise<number> {
  const { data } = await client.auth.getUser()
  if (!data.user) return 0
  const items = await pendingItems()
  let flushed = 0
  for (const item of items) {
    const path = cookPhotoPath(data.user.id, item.id)
    const { error: uploadError } = await client.storage
      .from(COOKS_BUCKET)
      .upload(path, item.photoBlob, { upsert: true })
    if (uploadError) continue
    const { error } = await client.rpc('create_cook', {
      p_cook_id: item.id,
      p_cooked_at: item.cookedAt,
      p_note: item.note,
      p_storage_path: path,
    })
    if (error) continue
    await db.pendingCooks.delete(item.id)
    flushed++
  }
  return flushed
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `npm test` — Expected: 5 passing.

- [ ] **Step 6: Build check + commit**

Run: `npm run build` — Expected: passes.

```bash
git add -A && git commit -m "feat: dexie pending queue with idempotent background flush"
```

---

### Task 5: Feed + capture UI

**Files:**
- Create: `src/lib/feed.ts`, `src/components/cook-card.tsx`, `src/components/feed.tsx`, `src/components/capture-button.tsx`, `src/app/capture/page.tsx`
- Modify: `src/app/page.tsx` (feed fetch + render), `src/app/layout.tsx` (fonts, viewport, wordmark-adjacent shell)

**Interfaces:**
- Consumes: `db`/`flushPending`/`createDraft`/`saveDraft`/`getDraft`/`pendingItems` (Task 4), `createClient`/`createServerClient`/`ensureProfile`/`isAllowedEmail` (Task 3).
- Produces: `FeedItem` type shared by server fetch and optimistic updates: `{ id: string; cookedAt: string; note: string; photoUrl: string | null }`.

- [ ] **Step 1: Feed type + server fetch helpers** — `src/lib/feed.ts`

```ts
export interface FeedItem {
  id: string
  cookedAt: string
  note: string
  photoUrl: string | null
}
```

Server fetch lives in `src/app/page.tsx` (Step 5) — it's the only consumer; no separate lib needed.

- [ ] **Step 2: Fonts + viewport in layout** — modify `src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Inter_Tight, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' })
const body = Inter_Tight({ subsets: ['latin'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Mise',
  description: 'A personal cooking log',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Mise' },
}

export const viewport: Viewport = {
  themeColor: '#EDEEEA',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable} font-body antialiased`}>
        {children}
      </body>
    </html>
  )
}
```

Add to `globals.css` (after the `@theme` block):

```css
@theme {
  --font-display: var(--font-display, sans-serif);
  --font-body: var(--font-body, sans-serif);
  --font-mono: var(--font-mono, monospace);
}
```

(Merge into the existing `@theme` block — don't create two.)

- [ ] **Step 3: Cook card** — `src/components/cook-card.tsx`

```tsx
import type { FeedItem } from '@/lib/feed'

export function CookCard({ item }: { item: FeedItem }) {
  const when = new Date(item.cookedAt)
  return (
    <article className="border-b border-hairline pb-6">
      {item.photoUrl && (
        <img
          src={item.photoUrl}
          alt=""
          className="mb-3 w-full bg-hairline object-cover"
        />
      )}
      {item.note && <p className="mb-2 text-lg leading-snug text-ink">{item.note}</p>}
      <p className="font-mono text-xs text-graphite">
        {when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
        · {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </article>
  )
}
```

- [ ] **Step 4: Feed component (client)** — `src/components/feed.tsx`

```tsx
'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending } from '@/lib/queue'
import { pendingItems } from '@/lib/db'
import { CookCard } from './cook-card'
import type { FeedItem } from '@/lib/feed'

export function Feed({ initialItems }: { initialItems: FeedItem[] }) {
  const queryClient = useQueryClient()
  const { data: items } = useQuery({
    queryKey: ['feed'],
    queryFn: async () => initialItems, // server truth arrives via invalidation below; initial render is the SSR data
    initialData: initialItems,
  })

  useEffect(() => {
    const sync = async () => {
      const supabase = createClient()
      await flushPending(supabase)
      const pending = await pendingItems()
      // Airplane-mode reload: unsynced captures still show, from IndexedDB.
      const pendingFeed: FeedItem[] = pending.map((p) => ({
        id: p.id,
        cookedAt: p.cookedAt,
        note: p.note,
        photoUrl: URL.createObjectURL(p.photoBlob),
      }))
      queryClient.setQueryData<FeedItem[]>(['feed'], (old = []) => {
        const ids = new Set(old.map((o) => o.id))
        return [...pendingFeed.filter((p) => !ids.has(p.id)), ...old]
      })
      void queryClient.invalidateQueries({ queryKey: ['feed'] })
    }
    void sync()
  }, [queryClient])

  return (
    <div className="flex flex-col gap-6">
      {items?.map((item) => <CookCard key={item.id} item={item} />)}
    </div>
  )
}
```

- [ ] **Step 5: Server page fetches the feed** — modify `src/app/page.tsx`

```tsx
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'
import { Feed } from '@/components/feed'
import { CaptureButton } from '@/components/capture-button'
import type { FeedItem } from '@/lib/feed'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

export default async function Home() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)

  const { data: cooks } = await supabase
    .from('cook')
    .select('id, cooked_at, note_raw, photo(storage_path)')
    .order('cooked_at', { ascending: false })

  const items: FeedItem[] = await Promise.all(
    (cooks ?? []).map(async (c) => {
      const photo = c.photo?.[0]
      let photoUrl: string | null = null
      if (photo) {
        const { data: signed } = await supabase.storage
          .from(COOKS_BUCKET)
          .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS)
        photoUrl = signed?.signedUrl ?? null
      }
      return { id: c.id, cookedAt: c.cooked_at, note: c.note_raw, photoUrl }
    }),
  )

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-5 pb-32 pt-5">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-ink">Mise</h1>
      </header>
      <Feed initialItems={items} />
      <CaptureButton />
    </main>
  )
}
```

- [ ] **Step 6: Capture button (thumb zone)** — `src/components/capture-button.tsx`

```tsx
'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createDraft } from '@/lib/db'

export function CaptureButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same photo
    if (!file) return
    const id = await createDraft(file) // capture writes to IndexedDB first (rule #2)
    router.push(`/capture?id=${id}`)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="mx-auto max-w-md px-5">
        <button
          onClick={() => inputRef.current?.click()}
          className="h-16 w-full bg-ink text-lg text-paper"
        >
          Capture
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
    </div>
  )
}
```

- [ ] **Step 7: Note screen** — `src/app/capture/page.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending } from '@/lib/queue'
import { getDraft, saveDraft } from '@/lib/db'
import type { FeedItem } from '@/lib/feed'

export default function Capture() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = useSearchParams().get('id')
  const [src, setSrc] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!id) {
      router.replace('/')
      return
    }
    void getDraft(id).then((draft) => {
      if (!draft) {
        router.replace('/')
        return
      }
      setSrc(URL.createObjectURL(draft.photoBlob))
    })
  }, [id, router])

  async function save() {
    if (!id) return
    await saveDraft(id, note)
    // Optimistic: the card is on the feed before the network knows.
    queryClient.setQueryData<FeedItem[]>(['feed'], (old = []) => [
      { id, cookedAt: new Date().toISOString(), note, photoUrl: src },
      ...old,
    ])
    router.replace('/')
    void flushPending(createClient())
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-paper px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-5">
      <div className="flex-1">
        {src && <img src={src} alt="" className="mb-4 w-full bg-hairline object-cover" />}
        <label htmlFor="note" className="sr-only">Note</label>
        <textarea
          id="note"
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is it, what's in it, how'd it go?"
          className="h-48 w-full resize-none border-b border-hairline bg-transparent text-lg leading-snug text-ink placeholder:text-graphite focus:outline-none"
        />
      </div>
      <button onClick={save} className="h-16 w-full bg-ink text-lg text-paper">
        Save cook
      </button>
    </main>
  )
}
```

- [ ] **Step 8: React Query provider** — wrap children in `src/app/layout.tsx` body:

```tsx
import { Providers } from '@/components/providers'
…
<body …>{<Providers>{children}</Providers>}</body>
```

Create `src/components/providers.tsx`:

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

- [ ] **Step 9: Verify build + manual flow (browser)**

Run: `npm run build` — Expected: passes.
Run: `npm run dev` → log in → Capture → pick/photo → note screen → Save cook → back on feed with the card; reload → card persists from the server. Also test: airplane-mode save → card stays (pending from IndexedDB on next online load).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: feed with optimistic capture — photo, note, background flush"
```

---

### Task 6: PWA shell — manifest, icons, service worker

**Files:**
- Create: `scripts/gen-icons.mjs`, `public/sw.js`, `src/app/manifest.ts`, `src/components/sw-register.tsx`
- Modify: `src/app/layout.tsx` (register SW)

**Interfaces:**
- Consumes: none from code; produces `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png` (180), `/manifest.webmanifest`, `/sw.js`.

- [ ] **Step 1: Icon generator (zero-dep PNG writer)** — `scripts/gen-icons.mjs`

```js
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixelFn) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size)
      const off = y * (size * 4 + 1) + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const INK = [0x14, 0x15, 0x0f]
const PAPER = [0xed, 0xee, 0xea]

// The mark: a paper plate ring with a dot of food on ink. Geometric, on-token.
function mark(x, y, size) {
  const d = Math.hypot(x - size / 2, y - size / 2)
  const ring = d > size * 0.26 && d < size * 0.34
  const dot = d < size * 0.08
  const c = ring || dot ? PAPER : INK
  return [...c, 255]
}

mkdirSync('public', { recursive: true })
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  writeFileSync(`public/${name}`, png(size, mark))
}
console.log('icons written')
```

- [ ] **Step 2: Generate icons**

Run: `node scripts/gen-icons.mjs` — Expected: three PNGs in `public/`. Add `"icons": "node scripts/gen-icons.mjs"` to package.json scripts.

- [ ] **Step 3: Manifest** — `src/app/manifest.ts`

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mise',
    short_name: 'Mise',
    start_url: '/',
    display: 'standalone',
    background_color: '#EDEEEA',
    theme_color: '#EDEEEA',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
```

- [ ] **Step 4: Hand-rolled service worker** — `public/sw.js`

```js
// Mise shell cache — navigations network-first (fresh RSC), static assets cache-first.
// Never caches cross-origin (Supabase photos/signed URLs are skipped by the origin check).
const CACHE = 'mise-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()))

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request).then((m) => m || caches.match('/'))),
    )
  } else {
    e.respondWith(
      caches.match(e.request).then(
        (m) =>
          m ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(e.request, copy))
            }
            return res
          }),
      ),
    )
  }
})
```

- [ ] **Step 5: Register it** — `src/components/sw-register.tsx`, mounted in `layout.tsx` body (inside `Providers`):

```tsx
'use client'

import { useEffect } from 'react'

export function SwRegister() {
  useEffect(() => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
```

- [ ] **Step 6: Build + PWA sanity check**

Run: `npm run build` — Expected: passes. Dev: DevTools → Application → Manifest shows name Mise + icons; Service worker registered. (iOS add-to-home-screen is verified in Task 7 on the deployed URL — localhost can't.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: PWA shell — manifest, icons, offline-first service worker"
```

---

### Task 7: Deploy to Vercel + phone acceptance

**Files:**
- Modify: none (Vercel config via CLI/UI)

**Prereq (user action):** none beyond having Vercel CLI logged in (verified: `sahiljoshi4-9626`).

- [ ] **Step 1: Link and deploy**

```bash
vercel link --yes   # creates + links the miz project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add ALLOWED_EMAILS production
vercel --prod
```

(Also set the three env vars for `preview` + `development` via the same `vercel env add` commands, so previews work.)

- [ ] **Step 2: Add the production redirect to Supabase**

In the Supabase dashboard → Auth → URL Configuration → Additional Redirect URLs: add `https://<vercel-domain>/auth/callback`. Also set Site URL to the production URL.

- [ ] **Step 3: Phone smoke test (Sahil does this — simulators lie)**

On the iPhone: open the deployed URL → log in via magic link → Add to Home Screen → open from home screen (standalone) → Capture → photo → dictation via mic key → Save cook → card appears instantly on the feed → airplane mode → capture + save again → card stays → back online → next open flushes it.

- [ ] **Step 4: Verify data in the dashboard**

Supabase → Table Editor → `cook`: both rows present with the correct `owner_id`; `cook_participant` has the owner row; `photo` rows have storage paths. Storage → `cooks` bucket → objects under `<owner_id>/<cook_id>/1.jpg`.

- [ ] **Step 5: Commit any remaining changes and tag the phase**

```bash
git add -A && git commit -m "chore: phase 0 deploy config" || true
git tag phase-0
```

**Acceptance (CLAUDE.md):** five actual dinners logged without thinking about it, every row owned and RLS-protected. The technical part of Phase 0 is done when Tasks 1–7 are complete; the phase closes when Sahil has logged the five dinners.

---

## Self-Review Notes

- **Spec coverage:** design spec §1 (migration/RLS/storage/auth) → Tasks 2–3; §2 (capture, Dexie-first save, optimistic, flush) → Tasks 4–5; §3 (feed, tokens, PWA, deploy) → Tasks 5–7. §4 error floor → queue tests + idempotent RPC (Task 4). §5 out-of-scope → nothing built. §6 acceptance → Task 7. Global constraint "EXIF via capture moment" → `cookedAt` = client `new Date()` at draft creation.
- **Type consistency:** `PendingCook` fields (`id/photoBlob/note/cookedAt/status`) match across db.ts, queue.ts, tests, and capture page. `FeedItem` matches server fetch (page.tsx) and optimistic updates (capture page, feed). RPC args `p_cook_id/p_cooked_at/p_note/p_storage_path` match between migration and queue.ts. `COOKS_BUCKET`/`cookPhotoPath` used by page.tsx, queue.ts, tests.
- **Known corners (flagged, deliberate):** no sign-out UI (clear cookies in Safari to reset); `ensureProfile` runs per page load (no-op insert); feed shows pending items on online reload but the queue never prunes abandoned `draft` rows (harmless, invisible); signed-URL expiry vs revocation is 2b's problem.
