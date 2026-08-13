'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ShareInvite() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.trim() || busy) return
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    setBusy(false)
    if (!res) return
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setEmail('')
      setMessage("Invite sent — they'll see it on their next visit.")
      router.refresh()
      return
    }
    if (json.error === 'self') return setMessage("That's you")
    if (json.error === 'not_joined') return setMessage("They haven't joined yet")
    setMessage('Something went wrong')
  }

  return (
    <div className="flex flex-col items-end">
      {open ? (
        <div className="flex items-center gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="email"
            className="w-36 border-b border-hairline bg-transparent font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink outline-none placeholder:text-graphite"
          />
          <button
            disabled={busy}
            onClick={submit}
            className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink hover:underline"
          >
            Share
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-graphite hover:text-ink"
        >
          Share
        </button>
      )}
      {message && (
        <p className="mt-1 max-w-44 text-right font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite">
          {message}
        </p>
      )}
    </div>
  )
}
