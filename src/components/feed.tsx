'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending, COOKS_BUCKET } from '@/lib/queue'
import { pendingItems } from '@/lib/db'
import { CookCard } from './cook-card'
import { dishMeta, type FeedItem } from '@/lib/feed'

async function fetchFeed(): Promise<FeedItem[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('cook')
    .select('id, cooked_at, note_raw, photo(storage_path), dish(canonical_name, cuisine)')
    .order('cooked_at', { ascending: false })
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
        ...dishMeta(c.dish),
      }
    }),
  )
}

export function Feed({ initialItems }: { initialItems: FeedItem[] }) {
  const queryClient = useQueryClient()
  const { data: items } = useQuery({
    queryKey: ['feed'],
    queryFn: fetchFeed,
    initialData: initialItems,
  })

  useEffect(() => {
    const sync = async () => {
      await flushPending(createClient())
      // refetchQueries settles without throwing on network failure (errors are
      // captured per-query), so the pending merge below still runs in airplane mode.
      await queryClient.refetchQueries({ queryKey: ['feed'] })
      const pending = await pendingItems()
      // Airplane-mode reload: unsynced captures still show, from IndexedDB.
      const pendingFeed: FeedItem[] = pending.map((p) => ({
        id: p.id,
        cookedAt: p.cookedAt,
        note: p.note,
        photoUrl: p.photoBlob ? URL.createObjectURL(p.photoBlob) : null,
        syncError: p.syncError,
      }))
      queryClient.setQueryData<FeedItem[]>(['feed'], (old = []) => {
        const ids = new Set(old.map((o) => o.id))
        return [...pendingFeed.filter((p) => !ids.has(p.id)), ...old]
      })
    }
    void sync()
  }, [queryClient])

  return (
    <div className="flex flex-col gap-12">
      {items?.map((item) => <CookCard key={item.id} item={item} syncError={item.syncError} />)}
    </div>
  )
}
