import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ensureProfile, isAllowedEmail } from '@/lib/auth'
import { COOKS_BUCKET } from '@/lib/queue'
import { Feed } from '@/components/feed'
import { CaptureButton } from '@/components/capture-button'
import { ShareBanner } from '@/components/share-banner'
import { ShareInvite } from '@/components/share-invite'
import { dishMeta, type FeedItem } from '@/lib/feed'

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed whenever the feed refetches

async function fetchItems(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  ownerId?: string,
): Promise<FeedItem[]> {
  let query = supabase
    .from('cook')
    .select('id, cooked_at, created_at, note_raw, tags, photo(storage_path), dish(canonical_name, cuisine)')
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data: cooks } = await query.order('created_at', { ascending: false })

  return Promise.all(
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
        tags: c.tags ?? [],
        ...dishMeta(c.dish),
      }
    }),
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user || !isAllowedEmail(data.user.email)) redirect('/login')
  await ensureProfile(supabase)
  const user = data.user

  const { data: myShares } = await supabase
    .from('view_share')
    .select('grantor_id, status')
    .eq('grantee_id', user.id)
  const shares = myShares ?? []
  const accepted = shares.filter((s) => s.status === 'accepted')
  const pending = shares.filter((s) => s.status === 'pending')

  // Profile RLS only exposes rows to sharing participants (or self); the
  // grantee is a participant, so grantor names resolve here.
  const grantorIds = shares.map((s) => s.grantor_id)
  const { data: grantors } = grantorIds.length
    ? await supabase.from('profile').select('id, display_name').in('id', grantorIds)
    : { data: [] }
  const nameOf = new Map((grantors ?? []).map((p) => [p.id, p.display_name]))

  const view = (await searchParams).view
  const acceptedIds = new Set(accepted.map((s) => s.grantor_id))
  const viewId = view ? (acceptedIds.has(view) ? view : null) : undefined
  if (viewId === null) redirect('/')
  const shared = !!viewId

  const items = await fetchItems(supabase, viewId)

  const base = 'font-mono text-[0.7rem] uppercase tracking-[0.14em] px-2 py-1'
  const active = `${base} bg-ink text-paper`
  const idle = `${base} text-graphite hover:text-ink`

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-5 pb-12 pt-5">
      {!shared && pending.length > 0 && (
        <ShareBanner
          pending={pending.map((s) => ({
            id: s.grantor_id,
            name: nameOf.get(s.grantor_id) ?? 'someone',
          }))}
        />
      )}
      <header className={accepted.length > 0 ? '' : 'border-b border-hairline pb-5'}>
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Mise</h1>
          <div className="flex items-baseline gap-4">
            {!shared && <ShareInvite />}
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-graphite">
              {items.length} cooks
            </p>
          </div>
        </div>
        {accepted.length > 0 && (
          <nav className="flex gap-1 border-b border-hairline pb-2 mb-4">
            <Link href="/" className={shared ? idle : active}>
              My log
            </Link>
            {accepted.map((s) => (
              <Link
                key={s.grantor_id}
                href={`/?view=${s.grantor_id}`}
                className={viewId === s.grantor_id ? active : idle}
              >
                {nameOf.get(s.grantor_id) ?? 'Theirs'}&apos;s log
              </Link>
            ))}
          </nav>
        )}
      </header>
      <Feed initialItems={items} ownerId={viewId} />
      {!shared && <CaptureButton />}
    </main>
  )
}
