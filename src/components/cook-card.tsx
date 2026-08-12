import type { FeedItem } from '@/lib/feed'

export function CookCard({ item }: { item: FeedItem }) {
  const when = new Date(item.cookedAt)
  return (
    <article className="border-b border-hairline pb-6">
      {item.photoUrl && (
        <img
          src={item.photoUrl}
          alt=""
          className="mb-3 w-full bg-hairline object-cover"
        />
      )}
      {item.note && <p className="mb-2 text-lg leading-snug text-ink">{item.note}</p>}
      <p className="font-mono text-xs text-graphite">
        {when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
        · {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </article>
  )
}
