# Quiet Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sahil can multi-select old photos from his camera roll; each becomes a real, EXIF-dated cook row enriched by Claude vision (cheap `claude-haiku-4-5` tier) — flagged `source='backfill'` so the feed stays a fresh log — while the enrichment prompts learn his personal dish vocabulary from all history.

**Architecture:** New `/api/backfill` route (server, user-session RLS) receives chunks of ~3 compressed, EXIF-dated photos; per photo it uploads to Storage, inserts cook+participant+photo via the extended `create_cook` RPC (now accepting `source`), then enriches inline with haiku-4-5 vision. Enrichment logic is extracted from `/api/enrich` into a shared `src/lib/enrichment.ts` so both routes use one pipeline; prompts gain a personal context block (owner's known dishes). The feed excludes `source='backfill'` rows.

**Tech Stack:** Next.js App Router, @anthropic-ai/sdk, DeepSeek REST, exifr, browser-image-compression, Supabase.

## Global Constraints

- Tokens only (`#14150F`/`#EDEEEA`/`#6B6D64`/`#D6D7D1`); dates/counts in mono; no modals; no new deps beyond those already installed.
- API keys server-side only (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY already in env); no service-role from client-touchable paths; all writes through the user session (RLS).
- Raw model output stored as `extraction` jsonb, never trimmed (CLAUDE.md rule 5).
- Feed stays a fresh log: `source='backfill'` rows never appear in any feed view.
- Claude models: `claude-sonnet-5` for normal photo enrichment (project spec §5.1), `claude-haiku-4-5` for backfill (spec's cheap bulk tier). No `thinking` param, no sampling params on 5-series; check `stop_reason === 'refusal'`.
- `npm run build` + `npm test` (currently 6 passing) before every commit; trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

### Task 1: Source flag + feed exclusion

**Files:**
- Create: `supabase/migrations/20260814000002_backfill_source.sql`
- Modify: `src/app/page.tsx` (own fetch), `src/components/feed.tsx` (`fetchFeed`)

**Interfaces:**
- Produces: `cook.source` = `'own' | 'backfill'` (all existing rows 'own'); `create_cook` accepts optional `p_source text default 'own'`; feed queries exclude backfill rows.

- [ ] **Step 1: Migration**

```sql
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
```

- [ ] **Step 2: Push migration**

Run: `npx supabase db push --db-url "postgresql://postgres:ELjJiYUAG2qOWhRX@db.fgtotudxudpcdmanmqne.supabase.co:5432/postgres"` — Expected: succeeds.

- [ ] **Step 3: Exclude backfill from both feed fetches**

In `src/app/page.tsx` own-feed select AND `src/components/feed.tsx` `fetchFeed`: add `.neq('source', 'backfill')` to the cook query (after the owner eq). Nothing else changes.

- [ ] **Step 4: Verify + commit**

Run: `npm run build` + `npm test` — Expected: pass, 6/6.

```bash
git add -A && git commit -m "feat: source flag — backfill rows hidden from feeds"
```

---

### Task 2: Shared enrichment lib + personal context block

**Files:**
- Create: `src/lib/enrichment.ts`
- Modify: `src/app/api/enrich/route.ts` (delegate to lib — behavior identical)
- Test: `src/lib/enrichment.test.ts`

**Interfaces:**
- Produces:
  - `interface EnrichResult { dish_name: string; cuisine: string; sub_region: string; ingredients: { name: string; amount: string }[]; techniques: string[]; confidence: { dish_name: 'high'|'medium'|'low'; cuisine: 'high'|'medium'|'low' }; cleaned_note: string }`
  - `modelForCook(cook: { source: string | null }): 'claude-sonnet-5' | 'claude-haiku-4-5'` — backfill → haiku-4-5, else sonnet-5. Pure, exported (tested in Task 3's test file too).
  - `enrichCookWith(supabase, user, cook, opts?: { model?: string }): Promise<EnrichResult>` — downloads photo (falls back to text path), calls Claude or DeepSeek, returns the parsed raw object. Throws on failure.
  - `writeEnrichment(supabase, user, cook, extraction): Promise<void>` — dish match/insert + tags derivation + cook update (extraction, enrichment_status 'done', dish_id, tags). Throws on failure.
  - `buildContext(supabase, user): Promise<string>` — owner's dish names (canonical_name, max 30, ordered by cook_count desc) joined ", " — used inside both prompts.
- Consumes: `COOKS_BUCKET` from `src/lib/queue`; `createServerClient`-shaped supabase client.

- [ ] **Step 1: Move logic into `src/lib/enrichment.ts`**

Transcribe the ENRICH_SCHEMA, ENRICH_PROMPT (Claude), DEEPSEEK_SYSTEM, the Claude call, the DeepSeek fetch, and the write-back from `src/app/api/enrich/route.ts` into the lib, as the functions above. Two changes while moving:
1. Claude model: `modelForCook(cook)` result passed as `model` (today always sonnet-5 — backfill wiring lands in Task 3).
2. Prompts gain the context block: append to ENRICH_PROMPT and DEEPSEEK_SYSTEM: `\n\nKnown dishes from this cook's own log: ${await buildContext(...)}` — fetched inside enrichCookWith before the model call (buildContext selects `canonical_name` from dish ordered by `cook_count desc` limit 30; RLS `can_view` returns owner rows).

- [ ] **Step 2: Rewrite the route as a thin shell**

`src/app/api/enrich/route.ts` keeps: auth gate, body parse, sweep/single mode selects, the try/catch that sets `enrichment_status='failed'` and swallows, response shapes. Its enrichCook body is replaced with calls to the lib. Behavior must be identical (same model choice, same prompts plus the context block, same write-back).

- [ ] **Step 3: Unit test**

`src/lib/enrichment.test.ts` (vitest, fake-indexeddb not needed):

```ts
import { describe, expect, it } from 'vitest'
import { modelForCook } from './enrichment'

describe('modelForCook', () => {
  it('uses haiku for backfill rows', () => {
    expect(modelForCook({ source: 'backfill' })).toBe('claude-haiku-4-5')
  })
  it('uses sonnet for own rows and legacy nulls', () => {
    expect(modelForCook({ source: 'own' })).toBe('claude-sonnet-5')
    expect(modelForCook({ source: null })).toBe('claude-sonnet-5')
  })
})
```

- [ ] **Step 4: Verify + commit**

Run: `npm test` (expect 8 passing) + `npm run build` + live DeepSeek probe (same as before: POST api.deepseek.com with a short note, confirm valid JSON).

```bash
git add -A && git commit -m "feat: shared enrichment lib with personal context block"
```

---

### Task 3: Backfill route + FAB option + client chunker

**Files:**
- Create: `src/app/api/backfill/route.ts`
- Create: `src/lib/backfill-client.ts`
- Modify: `src/components/capture-button.tsx` (third FAB sheet option + hidden multiple input)
- Test: extend `src/lib/enrichment.test.ts` or add `src/lib/backfill-client.test.ts`

**Interfaces:**
- Consumes: lib from Task 2 (`enrichCookWith`, `writeEnrichment`, `modelForCook`); `create_cook` RPC with `p_source` (Task 1).
- Produces: `/api/backfill` POST `{ photos: { dataUrl: string; cookedAt: string; fileName: string }[] }` → `{ imported: number }`; client helper `runBackfill(files: File[], onProgress: (done: number, total: number) => void): Promise<number>`.

- [ ] **Step 1: Client helper + test**

`src/lib/backfill-client.ts`:

```ts
import imageCompression from 'browser-image-compression'
import exifr from 'exifr'

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function prepare(file: File): Promise<{ dataUrl: string; cookedAt: string; fileName: string }> {
  const exif = await exifr.parse(file, { pick: ['DateTimeOriginal'] }).catch(() => null)
  const cookedAt = exif?.DateTimeOriginal instanceof Date
    ? exif.DateTimeOriginal.toISOString()
    : new Date().toISOString()
  const compressed = await imageCompression(file, {
    maxSizeMB: 1, maxWidthOrHeight: 1600, useWebWorker: false, fileType: 'image/jpeg',
  })
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(compressed)
  })
  return { dataUrl, cookedAt, fileName: file.name }
}

export async function runBackfill(files: File[], onProgress: (done: number, total: number) => void): Promise<number> {
  const chunks = chunk(files, 3)
  let imported = 0
  for (const batch of chunks) {
    const photos = await Promise.all(batch.map(prepare))
    const res = await fetch('/api/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos }),
    })
    if (!res.ok) throw new Error('backfill failed')
    const { imported: n } = await res.json()
    imported += n
    onProgress(imported, files.length)
  }
  return imported
}
```

Test (`src/lib/backfill-client.test.ts`): `chunk([1,2,3,4,5], 3)` → `[[1,2,3],[4,5]]`; `chunk([], 3)` → `[]`.

- [ ] **Step 2: Backfill route**

`src/app/api/backfill/route.ts` — `export const maxDuration = 60`:

```ts
// POST body: { photos: { dataUrl: string; cookedAt: string; fileName: string }[] }  (max 3)
// 1. auth gate (getUser + isAllowedEmail → 401)
// 2. for each photo (sequentially):
//    a. base64 → Buffer → upload to storage: path cookPhotoPath(user.id, cookId)
//       (COOKS_BUCKET, upsert true) — cookId = crypto.randomUUID()
//    b. rpc('create_cook', { p_cook_id: cookId, p_cooked_at: cookedAt, p_note: '',
//       p_storage_path: path, p_source: 'backfill' })
//    c. fetch the inserted cook row (id, note_raw, photo(storage_path), source) — or construct the object directly (id, note_raw: '', photo: [{storage_path: path}], source: 'backfill')
//    d. const extraction = await enrichCookWith(supabase, user, cookObj)  // modelForCook → haiku
//    e. await writeEnrichment(supabase, user, cookObj, extraction)
//    f. on ANY error for a photo: update cook enrichment_status='failed', continue with next photo
// 3. return { imported: n } (count of photos fully enriched)
```

- [ ] **Step 3: FAB third option**

`src/components/capture-button.tsx`: in the sheet, add a third button "Backfill" (outline, same style as Upload) + a second hidden input `type="file" accept="image/*" multiple` (no capture attr). On change: `const files = Array.from(e.target.files ?? [])`; `setBusy(true)` + a progress line state `Backfilled ${done}/${total}…` rendered above the FAB (text-graphite mono, same inline-error pattern — no modal); `runBackfill(files, (done, total) => setProgress(...))`; on completion show `Imported ${total} photos` for a few seconds; on error the inline error paragraph. Reset input value after selection.

- [ ] **Step 4: Verify + commit**

Run: `npm test` (expect 10 passing) + `npm run build`.

```bash
git add -A && git commit -m "feat: quiet backfill — camera-roll import, EXIF dates, haiku vision, hidden from feed"
```

---

## Self-Review Notes

- **Spec coverage:** hidden rows → Task 1 (feed neq) + Task 3 (source 'backfill' insert); EXIF dates → Task 3 `prepare()`; haiku vision → Task 2 `modelForCook` + Task 3 route; context block → Task 2 `buildContext` in prompts; fresh feed preserved → Task 1. User's "quickly and methodically" → chunks of 3 with progress line.
- **Type consistency:** `EnrichResult`/`enrichCookWith`/`writeEnrichment`/`buildContext`/`modelForCook` names match across Tasks 2-3; `p_source` param matches between migration (Task 1) and route rpc call (Task 3); `cookPhotoPath` reused from `src/lib/queue`.
- **Known corners (ledger):** backfill enriches inline per chunk (≈30s/3 photos, sequential); a 200-photo import takes ~30 min of background taps — acceptable slice 1, batch queue later. No note on backfilled rows by design (vision-only). Imported rows get `cooked_at` from EXIF (original date), invisible in feeds, but count toward future search/analytics.
