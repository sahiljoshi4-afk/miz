import { cuisineColor } from '@/lib/cuisine'

export function CuisineTag({ cuisine }: { cuisine: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.14em] text-graphite">
      <span
        aria-hidden
        className="h-[7px] w-[7px] rounded-full"
        style={{ backgroundColor: cuisineColor(cuisine) }}
      />
      {cuisine}
    </span>
  )
}
