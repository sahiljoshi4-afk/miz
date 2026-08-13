import type { FeedItem } from '@/lib/feed'

export function CookCard({ item }: { item: FeedItem }) {
  const when = new Date(item.cookedAt)
  const whenLabel =
    `${when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` +
    ` · ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return (
    <article>
      {item.photoUrl && (
        <div className="overflow-hidden bg-hairline">
          <img src={item.photoUrl} alt="" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      {item.note && (
        <h2
          className={
            'font-display text-[1.6rem] leading-[1.1] font-medium tracking-[-0.025em] text-ink' +
            (item.photoUrl ? ' mt-4' : '')
          }
        >
          {item.note}
        </h2>
      )}
      <p className="mt-2 font-mono text-[0.7rem] text-graphite">{whenLabel}</p>
    </article>
  )
}
