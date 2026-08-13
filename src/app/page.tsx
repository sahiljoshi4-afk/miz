import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'
import { Feed } from '@/components/feed'
import { CaptureButton } from '@/components/capture-button'
import { dishMeta, type FeedItem } from '@/lib/feed'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

export default async function Home() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)

  const { data: cooks } = await supabase
    .from('cook')
    .select('id, cooked_at, created_at, note_raw, photo(storage_path), dish(canonical_name, cuisine)')
    .order('created_at', { ascending: false })

  const items: FeedItem[] = await Promise.all(
    (cooks ?? []).map(async (c) => {
      const photo = c.photo?.[0]
      let photoUrl: string | null = null
      if (photo) {
        const { data: signed } = await supabase.storage
          .from(COOKS_BUCKET)
          .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS)
        photoUrl = signed?.signedUrl ?? null
      }
      return {
        id: c.id,
        cookedAt: c.cooked_at,
        note: c.note_raw,
        photoUrl,
        ...dishMeta(c.dish),
      }
    }),
  )

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-5 pb-12 pt-5">
      <header className="border-b border-hairline pb-5">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Mise</h1>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-graphite">
            {items.length} cooks
          </p>
        </div>
      </header>
      <Feed initialItems={items} />
      <CaptureButton />
    </main>
  )
}
