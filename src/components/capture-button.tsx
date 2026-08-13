'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDraft } from '@/lib/db'

export function CaptureButton() {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState(false)

  async function start(photoBlob: Blob | null) {
    try {
      const id = await createDraft(photoBlob) // capture writes to IndexedDB first (rule #2)
      router.push(`/capture?id=${id}`)
    } catch {
      setError(true)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same photo
    if (!file) return
    void start(file)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="mx-auto max-w-md px-5">
        {error && (
          <p className="pb-2 text-center text-sm text-graphite">Couldn&apos;t save the draft — try again</p>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => libraryInputRef.current?.click()}
              className="h-16 flex-1 border border-ink text-lg text-ink"
            >
              Upload
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="h-16 flex-1 bg-ink text-lg text-paper"
            >
              Capture
            </button>
          </div>
          <button
            onClick={() => void start(null)}
            className="h-16 w-full border border-ink text-lg text-ink"
          >
            Note only
          </button>
        </div>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
    </div>
  )
}
