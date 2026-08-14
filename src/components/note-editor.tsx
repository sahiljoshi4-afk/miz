'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function NoteEditor({ cookId, initialNote }: { cookId: string; initialNote: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initialNote)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function save() {
    setBusy(true)
    setError(false)
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('cook')
      .update({ note_raw: value, enrichment_status: 'queued' })
      .eq('id', cookId)
    if (updateError) {
      setError(true)
      setBusy(false)
      return
    }
    void fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookId }),
    }).catch(() => {})
    router.refresh()
    setBusy(false)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-graphite underline decoration-hairline"
      >
        Edit note
      </button>
    )
  }

  return (
    <div className="mt-3">
      <textarea
        aria-label="Edit note"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-40 w-full resize-none border border-hairline bg-transparent p-3 text-lg leading-snug focus:outline-none"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="h-11 bg-ink px-4 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-paper"
        >
          Save
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={busy}
          className="h-11 border border-ink px-4 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-graphite">Couldn&apos;t save — try again</p>}
    </div>
  )
}
