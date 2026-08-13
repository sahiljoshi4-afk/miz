import Link from 'next/link'
import type { FeedItem } from '@/lib/feed'
import { cuisineColor } from '@/lib/cuisine'
import { CuisineTag } from '@/components/cuisine-tag'
import { CookDate } from '@/components/cook-date'

export function CookCard({ item, syncError }: { item: FeedItem; syncError?: string }) {
  const cuisine = item.cuisine ?? null
  return (
    <Link href={`/cooks/${item.id}`} className="block">
      {item.photoUrl && (
        <div className="overflow-hidden bg-hairline">
          <img src={item.photoUrl} alt="" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      <div
        className={cuisine ? 'mt-4 border-l-2 pl-4' : 'mt-4'}
        style={cuisine ? { borderColor: cuisineColor(cuisine) } : undefined}
      >
        {item.dishName && (
          <h2 className="font-display text-[1.6rem] leading-[1.1] font-medium tracking-[-0.025em]">
            {item.dishName}
          </h2>
        )}
        <div className="mt-2 flex items-center justify-between gap-4">
          {cuisine && <CuisineTag cuisine={cuisine} />}
          <span className="font-mono text-[0.7rem] text-graphite">
            <CookDate iso={item.cookedAt} />
          </span>
        </div>
      </div>
      {syncError && (
        <p className="mt-1 font-mono text-[0.65rem] text-graphite">unsynced · {syncError}</p>
      )}
    </Link>
  )
}
