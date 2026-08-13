'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDraft } from '@/lib/db'

export function CaptureButton() {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState(false)

  async function start(file: Blob) {
    try {
      const id = await createDraft(file) // capture writes to IndexedDB first (rule #2)
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
    <div>
      {error && (
        <p className="pb-2 text-center text-sm text-graphite">Couldn&apos;t save the draft — try again</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => libraryInputRef.current?.click()}
          className="h-11 flex-1 border border-ink text-lg text-ink"
        >
          Upload
        </button>
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="h-11 flex-1 bg-ink text-lg text-paper"
        >
          Capture
        </button>
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
