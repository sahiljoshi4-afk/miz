'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending } from '@/lib/queue'
import { getDraft, saveDraft } from '@/lib/db'
import type { FeedItem } from '@/lib/feed'

function Capture() {
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

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <Capture />
    </Suspense>
  )
}
