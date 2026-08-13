'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ShareBanner({ pending }: { pending: { id: string; name: string }[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function act(verb: 'accept' | 'ignore', id: string) {
    setBusy(true)
    await fetch('/api/share', {
      method: verb === 'accept' ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verb === 'accept' ? { acceptGrantorId: id } : { otherId: id }),
    }).catch(() => {})
    router.refresh()
  }

  return (
    <div className="border-b border-hairline pb-3 mb-3">
      {pending.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 py-2"
        >
          <p className="text-sm text-ink">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              {p.name}
            </span>{' '}
            shared their log with you
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              disabled={busy}
              onClick={() => act('accept', p.id)}
              className="bg-ink px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-paper"
            >
              Accept
            </button>
            <button
              disabled={busy}
              onClick={() => act('ignore', p.id)}
              className="border border-hairline px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-graphite"
            >
              Ignore
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
