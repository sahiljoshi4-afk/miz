'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reason = useSearchParams().get('reason')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email) return
    setBusy(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setBusy(false)
    if (err) setError(err.message)
    else setSent(true)
  }

  return (
    <main className="flex min-h-dvh flex-col justify-between bg-paper p-6">
      <h1 className="font-display text-3xl text-ink">Mise</h1>
      {reason === 'not-invited' && (
        <p className="text-graphite">This email isn&apos;t on the list yet.</p>
      )}
      {sent ? (
        <p className="text-ink">Check your email — the link opens your log.</p>
      ) : (
        <>
          <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="email" className="sr-only">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-14 rounded-none border border-hairline bg-transparent px-4 text-lg text-ink placeholder:text-graphite"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-14 bg-ink text-paper disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
          {error && <p className="text-graphite">{error}</p>}
        </>
      )}
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  )
}
