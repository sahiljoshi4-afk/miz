# Phase 0 — Capture Loop Design

**Date:** 2026-08-12
**Status:** approved
**Repo:** miz (Mise cooking log PWA)

## Context

Phase 0 per `CLAUDE.md`: prove the loop, on a per-owner foundation. One screen — take a photo, save a row, see it on a feed. No AI, no enrichment, no sharing. But ownership done right from the first migration: `profile`, magic-link auth, `owner_id` on every cook and dish, owner-scoped RLS.

Settled in brainstorming (2026-08-12):

1. **Supabase:** new hosted project (dashboard-created), migrations managed via CLI.
2. **Landing:** feed with capture button fixed in the thumb zone (spec §15.1 recommendation confirmed).
3. **Capture scope:** photo **plus** note field (textarea, iOS dictation via mic key). Photo-only and note-only entries both valid.
4. **Offline save:** minimal Dexie queue (Approach B) — save lands in IndexedDB before touching the network, per architecture rule #2.

## 1. Data & auth

### Migration 001

Single migration `001_phase0_schema.sql`, the **full §4.3 schema** so nothing is retrofitted later:

- `create extension if not exists vector` (pgvector)
- Tables: `profile`, `view_share`, `dish`, `cook`, `cook_participant`, `photo`, `ingredient`, `cook_ingredient`, `technique`, `cook_technique`, `correction`
- `owner_id` columns default to `auth.uid()` — the client never asserts identity
- RLS enabled on **every** table from this migration

### RLS predicates (§4.4)

Two `security definer` functions:

- `is_participant(cook_row)` — `auth.uid()` appears in `cook_participant` for that cook
- `can_view(owner_id)` — `auth.uid() = owner_id`, or an accepted `view_share` from that owner exists

Policies:

- `cook` — read: `is_participant OR can_view(owner_id)`; write: `is_participant`
- `dish`, `ingredient`, `technique` — read: `can_view(owner_id)`; write: owner only
- `photo`, `cook_ingredient`, `cook_technique` — join through the parent `cook` and reuse its rule
- `cook_participant` — read via the parent cook's rule; insert by the cook's owner (Phase 0: server inserts the owner row)
- `profile` — read/write: self only. (Spec §4.4's sharing-relationship read arrives with view-shares in 2b; with no shares existing, self-only is behaviourally identical. The policy is extended in 2b, not migrated.)
- `view_share` — each side reads rows naming them; grantor creates/revokes. Table and policies exist now; no UI until 2b.

### Auth

- Supabase **magic link** (hosted default SMTP — fine for one user)
- **Invite-only stand-in:** `ALLOWED_EMAILS` env var, checked in the app server layer. Non-allowed email → signed out, "not invited" state. Worst case an uninvited sign-in sees their own empty log — RLS means nothing leaks. The real invite flow (email → magic link → profile) replaces this in 2b.
- **Profile creation:** lazy `ensureProfile()` insert on first authenticated load — a plain RLS-allowed self-insert (`insert ... on conflict do nothing`). No trigger, no service role. Called by the server layer before feed/cook operations.

### Photo storage

- Private bucket `cooks`
- Path: `{owner_id}/{cook_id}/1.jpg`
- Storage policy: read/write `auth.uid() = (storage.foldername(name))[1]::uuid` — exactly one person can read, enforced by Storage itself. Extended with participant logic in 2b.
- Feed serves **signed URLs** (7-day expiry, refreshed when react-query refetches). No proxy route, no public bucket. `ponytail:` signed URL expiry vs revocation — revisit if a revoked view-share must not see cached URLs (2b).

## 2. Capture flow (Phase 0 edition)

1. **Feed** → thumb-zone capture button (`position: fixed`, bottom third, ≥56px target)
2. Native camera via `<input type="file" accept="image/*" capture="environment">` — single photo (multi-photo is Phase 1)
3. **Note screen:** photo thumbnail from local blob URL, one auto-focused textarea (mic key = dictation), "Save cook" button. No other controls, no dropdowns, no modals, no required fields.

### Save order (Approach B)

1. **Dexie pending queue first** — `pending_cooks` table, client-generated id, photo blob + note + `cooked_at` stored in IndexedDB. The durable write; works in airplane mode.
2. Optimistic card at top of feed (blob URL image), back on feed immediately (<300ms target).
3. Background flush: upload blob → insert `cook` + `photo` + owner's `cook_participant` row (owner from `auth.uid()` server-side) → delete Dexie entry → swap blob URL for signed URL.
4. Failed flushes stay pending, retry on next app foreground/open. No toasts, no modals. Nothing lost.

### Deliberate deferrals (all Phase 1 or later)

- Compression (`browser-image-compression`) — Phase 1
- Multi-photo, `multiple` attribute — Phase 1
- EXIF parsing — Phase 2 (backfill). `cooked_at` = client capture moment; for fresh shots this equals EXIF `DateTimeOriginal`. Architecture rule #9 is honoured for capture; backfill needs real EXIF.
- Realtime feed updates — Phase 1 (enrichment cards filling in)
- Rating, cuisine picker, venue toggle — later phases

## 3. Feed, PWA shell, deploy

- **Feed:** reverse-chron, one large photo per card, note beneath, date in IBM Plex Mono. Tiny "Mise" wordmark. Tokens: ink/paper/graphite/hairline only — no accent colours until cuisine data drives them.
- **PWA:** manifest (name "Mise", standalone, icon) + hand-rolled service worker (per spec — no `next-pwa`): precache app shell, runtime-cache static assets.
- **Fonts:** `next/font` — Bricolage Grotesque (display, dish names — unused in Phase 0 but wired), Inter Tight (UI), IBM Plex Mono (data).
- **Deploy:** Vercel. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_EMAILS`. `npm run build` before every deploy. Test on the actual iPhone (simulators lie).
- **Dependencies:** `next`, `react`, `typescript`, `tailwindcss`, `@supabase/supabase-js`, `@supabase/ssr`, `dexie`, `@tanstack/react-query`. Nothing else.

## 4. Error handling (non-negotiable floor)

- Save failure: entry stays in Dexie, card stays visible (marked unsynced), retry on next open — never a dropped capture.
- Upload/insert failure mid-flush: Dexie row untouched until the server write is confirmed → no data loss, possible duplicate upload is harmless (idempotent by client-generated cook id).
- Auth errors: redirect to login; server layer checks session before every data operation.
- Signed URL generation failure: card shows the local blob until the flush completes.

## 5. Out of scope (explicitly)

No AI/Claude key, no enrichment, no embeddings, no search, no view-shares UI, no co-cooking UI, no invite flow UI, no settings screen, no backfill, no desktop/Android optimisation.

## 6. Acceptance

CLAUDE.md: five actual dinners logged without thinking about it, every row owned and RLS-protected. Smoke check: `npm run build` + manual signed-in flow on the phone.

## Open items carried forward (spec §15, not touched by Phase 0)

- §15.3 confidence threshold / "Check this" semantics — Phase 1
- §15.4 nutrition estimates — Phase 1/8
- §15.5 dish granularity — Phase 3
- §15.6/7 co-cook dish attachment + enrichment context — Phase 2b/3
- §15.8 name — "Mise" placeholder for now; renaming is a small change
- §15.2 rating — confirmed never at capture; no rating UI in Phase 0
