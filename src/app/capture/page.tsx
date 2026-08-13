'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { flushPending } from '@/lib/queue'
import { db, getDraft, saveDraft, type PendingCook } from '@/lib/db'
import type { FeedItem } from '@/lib/feed'
import imageCompression from 'browser-image-compression'

// HEIC/HEIF breaks in <img> from blob URLs; normalize everything to JPEG.
async function compressDraft(
  draft: PendingCook,
  setSrc: (src: string) => void,
): Promise<void> {
  if (!draft.photoBlob) return
  // Fallback type: HEIC blobs with an empty type (legacy iOS) would fail the
  // library's /^image/ guard; output is forced to JPEG regardless.
  const inputType = draft.photoBlob.type || 'image/jpeg'
  const compressed = await imageCompression(
    new File([draft.photoBlob], 'photo.jpg', { type: inputType }),
    {
      maxSizeMB: 1,
      maxWidthOrHeight: 1600,
      useWebWorker: false, // main thread — WebKit PWA workers are flaky; 1-2s while typing
      fileType: 'image/jpeg',
    },
  )
  await db.pendingCooks.update(draft.id, { photoBlob: compressed })
  setSrc(URL.createObjectURL(compressed)) // swap the thumbnail once the JPEG is ready
}

function Capture() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = useSearchParams().get('id')
  const [draft, setDraft] = useState<PendingCook | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!id) {
      router.replace('/')
      return
    }
    void (async () => {
      const { data } = await createClient().auth.getUser()
      if (!data.user) {
        router.replace('/login')
        return
      }
      const found = await getDraft(id)
      if (!found) {
        router.replace('/')
        return
      }
      setDraft(found)
      if (found.photoBlob) {
        setSrc(URL.createObjectURL(found.photoBlob))
        // fire-and-forget; navigation stays instant
        void compressDraft(found, setSrc).catch((e) => console.warn('compress failed', e))
      }
    })()
  }, [id, router])

  async function save() {
    if (!id) return
    await saveDraft(id, note)
    // Optimistic: the card is on the feed before the network knows.
    queryClient.setQueryData<FeedItem[]>(['feed'], (old = []) => [
      { id, cookedAt: draft?.cookedAt ?? new Date().toISOString(), note, photoUrl: src },
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
