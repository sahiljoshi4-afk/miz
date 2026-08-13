'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function Login() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reason = useSearchParams().get('reason')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) return
    setBusy(true)
    const email = username.includes('@')
      ? username.trim()
      : `${username.trim()}@mise.app`
    const supabase = createClient()
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (err) setError(err.message)
      else router.replace('/')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-between bg-paper p-6">
      <h1 className="font-display text-3xl text-ink">Mise</h1>
      {reason === 'not-invited' && (
        <p className="text-graphite">This email isn&apos;t on the list yet.</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="username" className="sr-only">Username</label>
        <input
          id="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          className="h-14 rounded-none border border-hairline bg-transparent px-4 text-lg text-ink placeholder:text-graphite"
        />
        <label htmlFor="password" className="sr-only">Password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="h-14 rounded-none border border-hairline bg-transparent px-4 text-lg text-ink placeholder:text-graphite"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-14 bg-ink text-paper disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p className="text-graphite">{error}</p>}
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
