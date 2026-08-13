import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'
import { CookDate } from '@/components/cook-date'
import { CuisineTag } from '@/components/cuisine-tag'
import { dishMeta } from '@/lib/feed'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

export default async function CookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)

  const { data: cook } = await supabase
    .from('cook')
    .select('id, cooked_at, note_raw, extraction, photo(storage_path), dish(canonical_name, cuisine)')
    .eq('id', id)
    .maybeSingle()
  if (!cook) notFound()

  const cleanedNote =
    typeof cook.extraction?.cleaned_note === 'string' && cook.extraction.cleaned_note.length > 0
      ? cook.extraction.cleaned_note
      : null
  const mainNote = cleanedNote ?? cook.note_raw

  const { dishName, cuisine } = dishMeta(cook.dish)
  const photo = cook.photo?.[0]
  let photoUrl: string | null = null
  if (photo) {
    const { data: signed } = await supabase.storage
      .from(COOKS_BUCKET)
      .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS)
    photoUrl = signed?.signedUrl ?? null
  }

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
      {dishName && (
        <h1 className="mt-5 font-display text-3xl font-medium tracking-[-0.025em]">{dishName}</h1>
      )}
      {cuisine && (
        <div className="mt-2">
          <CuisineTag cuisine={cuisine} />
        </div>
      )}
      {photoUrl && (
        <div className="mt-5 overflow-hidden bg-hairline">
          <img src={photoUrl} alt="" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      {mainNote && <p className="mt-5 whitespace-pre-wrap text-lg leading-snug">{mainNote}</p>}
      {cleanedNote && cook.note_raw && (
        <p className="mt-4 font-mono text-xs text-graphite whitespace-pre-wrap">{cook.note_raw}</p>
      )}
      <p className="mt-2 font-mono text-[0.7rem] text-graphite">
        <CookDate iso={cook.cooked_at} />
      </p>
    </main>
  )
}
