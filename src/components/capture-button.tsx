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
