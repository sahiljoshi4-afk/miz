'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending, COOKS_BUCKET } from '@/lib/queue'
import { db, pendingItems } from '@/lib/db'
import { CookCard } from './cook-card'
import { dishMeta, type FeedItem } from '@/lib/feed'

async function fetchFeed(ownerId?: string): Promise<FeedItem[]> {
  const supabase = createClient()
  let query = supabase
    .from('cook')
    .select('id, cooked_at, created_at, note_raw, tags, photo(storage_path), dish(canonical_name, cuisine)')
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data } = await query.order('created_at', { ascending: false })
  return Promise.all(
    (data ?? []).map(async (c): Promise<FeedItem> => {
      const photo = c.photo?.[0]
      let photoUrl: string | null = null
      if (photo) {
        const { data: signed } = await supabase.storage
          .from(COOKS_BUCKET)
          .createSignedUrl(photo.storage_path, 60 * 60 * 24 * 7)
        photoUrl = signed?.signedUrl ?? null
      }
      return {
        id: c.id,
        cookedAt: c.cooked_at,
        note: c.note_raw,
        photoUrl,
        tags: c.tags ?? [],
        ...dishMeta(c.dish),
      }
    }),
  )
}

export function Feed({
  initialItems,
  ownerId,
}: {
  initialItems: FeedItem[]
  ownerId?: string
}) {
  const queryClient = useQueryClient()
  const key = ['feed', ownerId ?? 'me']
  const { data: items } = useQuery({
    queryKey: key,
    queryFn: () => fetchFeed(ownerId),
    initialData: initialItems,
  })

  useEffect(() => {
    const sync = async () => {
      if (!ownerId) await flushPending(createClient())
      // refetchQueries settles without throwing on network failure (errors are
      // captured per-query), so the pending merge below still runs in airplane mode.
      await queryClient.refetchQueries({ queryKey: ['feed', ownerId ?? 'me'] })
      if (!ownerId) {
        const pending = await pendingItems()
        // Airplane-mode reload: unsynced captures still show, from IndexedDB.
        const pendingFeed: FeedItem[] = pending.map((p) => ({
          id: p.id,
          cookedAt: p.cookedAt,
          note: p.note,
          photoUrl: p.photoBlob ? URL.createObjectURL(p.photoBlob) : null,
          syncError: p.syncError,
        }))
        queryClient.setQueryData<FeedItem[]>(['feed', 'me'], (old = []) => {
          const ids = new Set(old.map((o) => o.id))
          return [...pendingFeed.filter((p) => !ids.has(p.id)), ...old]
        })
        // Fire-and-forget sweep; the card updates when enrichment lands.
        void fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(() => {})
        setTimeout(() => {
          void queryClient.refetchQueries({ queryKey: ['feed', 'me'] })
        }, 25000)
      }
    }
    void sync()
  }, [queryClient, ownerId])

  return (
    <div className="flex flex-col gap-12">
      {items?.map((item) => (
        <CookCard
          key={item.id}
          item={item}
          syncError={item.syncError}
          onDiscard={async (id) => {
            await db.pendingCooks.delete(id)
            queryClient.setQueryData<FeedItem[]>(key, (old = []) =>
              old.filter((f) => f.id !== id),
            )
          }}
        />
      ))}
    </div>
  )
}
