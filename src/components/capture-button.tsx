'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import exifr from 'exifr'
import { createDraft } from '@/lib/db'
import { runBackfill } from '@/lib/backfill-client'

export function CaptureButton() {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const backfillInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  // Scroll-aware FAB: fade out while scrolling, back ~250ms after it stops.
  // Reduced motion: skip the transitions entirely, stay visible.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      setVisible(false)
      clearTimeout(timer)
      timer = setTimeout(() => setVisible(true), 250)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [])

  // Sheet closes on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function start(file: Blob) {
    try {
      let cookedAt: string | undefined
      try {
        const exif = await exifr.parse(file, { pick: ['DateTimeOriginal'] })
        if (exif?.DateTimeOriginal instanceof Date) cookedAt = exif.DateTimeOriginal.toISOString()
      } catch {
        // EXIF must never block capture — fall back to now
      }
      const id = await createDraft(file, cookedAt) // capture writes to IndexedDB first (rule #2)
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

  async function onBackfill(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same photos
    if (files.length === 0) return
    setOpen(false)
    setBackfillError(null)
    setProgress('Backfilled 0/0…')
    try {
      const imported = await runBackfill(files, (done, total) =>
        setProgress(`Backfilled ${done}/${total}…`),
      )
      setProgress(`Imported ${imported} photos`)
      setTimeout(() => setProgress(null), 4000)
    } catch {
      setProgress(null)
      setBackfillError("Couldn't import those photos — try again")
    }
  }

  return (
    <div
      className={`fixed right-5 bottom-[max(env(safe-area-inset-bottom),1.25rem)] z-10 transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {open && (
        <>
          <button
            aria-label="Close capture menu"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-16 right-0 z-20 flex w-44 flex-col gap-2 rounded-none border border-hairline bg-paper p-2">
            {error && (
              <p className="px-1 text-sm text-graphite">Couldn&apos;t save the draft — try again</p>
            )}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="h-12 bg-ink text-lg text-paper"
            >
              Take photo
            </button>
            <button
              onClick={() => libraryInputRef.current?.click()}
              className="h-12 border border-ink text-lg text-ink"
            >
              Upload
            </button>
            <button
              onClick={() => backfillInputRef.current?.click()}
              className="h-12 border border-ink text-lg text-ink"
            >
              Backfill
            </button>
          </div>
        </>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Log a new cook"
        aria-expanded={open}
        className="relative z-20 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-2xl leading-none text-paper shadow-lg"
      >
        <span aria-hidden className="-mt-0.5">
          +
        </span>
      </button>
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
      <input
        ref={backfillInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onBackfill}
      />
      {progress && (
        <p className="absolute right-0 bottom-20 font-mono text-[0.7rem] text-graphite">
          {progress}
        </p>
      )}
      {backfillError && (
        <p className="absolute right-0 bottom-20 font-mono text-[0.7rem] text-graphite">
          {backfillError}
        </p>
      )}
    </div>
  )
}
