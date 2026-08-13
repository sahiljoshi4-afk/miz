import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

export default async function CookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)

  const { data: cook } = await supabase
    .from('cook')
    .select('id, cooked_at, note_raw, photo(storage_path)')
    .eq('id', id)
    .maybeSingle()
  if (!cook) notFound()

  const photo = cook.photo?.[0]
  let photoUrl: string | null = null
  if (photo) {
    const { data: signed } = await supabase.storage
      .from(COOKS_BUCKET)
      .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS)
    photoUrl = signed?.signedUrl ?? null
  }

  const when = new Date(cook.cooked_at)
  const whenLabel =
    `${when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` +
    ` · ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-5 pb-12 pt-5">
      <header className="border-b border-hairline pb-5">
        <Link
          href="/"
          className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-graphite"
        >
          ← Mise
        </Link>
      </header>
      {photoUrl && (
        <div className="mt-5 overflow-hidden bg-hairline">
          <img src={photoUrl} alt="" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      {cook.note_raw && <p className="mt-5 text-lg leading-snug">{cook.note_raw}</p>}
      <p className="mt-2 font-mono text-[0.7rem] text-graphite">{whenLabel}</p>
    </main>
  )
}
