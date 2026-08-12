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
