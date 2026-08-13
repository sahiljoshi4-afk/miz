import Link from 'next/link'
import type { FeedItem } from '@/lib/feed'
import { CookDate } from '@/components/cook-date'

export function CookCard({ item, syncError }: { item: FeedItem; syncError?: string }) {
  return (
    <Link href={`/cooks/${item.id}`} className="block">
      {item.photoUrl && (
        <div className="overflow-hidden bg-hairline">
          <img src={item.photoUrl} alt="" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      {/* Phase 1: AI dish title fills in here */}
      <p className="mt-2 font-mono text-[0.7rem] text-graphite">
        <CookDate iso={item.cookedAt} />
      </p>
      {syncError && (
        <p className="mt-1 font-mono text-[0.65rem] text-graphite">unsynced · {syncError}</p>
      )}
    </Link>
  )
}
