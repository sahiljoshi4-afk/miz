import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'
import { Feed } from '@/components/feed'
import { CaptureButton } from '@/components/capture-button'
import type { FeedItem } from '@/lib/feed'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

export default async function Home() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)

  const { data: cooks } = await supabase
    .from('cook')
    .select('id, cooked_at, note_raw, photo(storage_path)')
    .order('cooked_at', { ascending: false })

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
      return { id: c.id, cookedAt: c.cooked_at, note: c.note_raw, photoUrl }
    }),
  )

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-5 pb-32 pt-5">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-ink">Mise</h1>
      </header>
      <Feed initialItems={items} />
      <CaptureButton />
    </main>
  )
}
