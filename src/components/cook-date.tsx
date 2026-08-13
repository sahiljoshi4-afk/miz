'use client'

export function CookDate({ iso, className }: { iso: string; className?: string }) {
  const d = new Date(iso)
  const when = `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return <span className={className}>{when}</span>
}
