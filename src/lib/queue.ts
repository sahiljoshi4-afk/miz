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
