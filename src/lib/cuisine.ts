/**
 * Cuisine as colour: the chrome is neutral, every hue below belongs to data.
 * Fixed hues for known cuisines, deterministic hash for the rest — same S/L
 * so no cuisine shouts louder.
 */
const cuisineHue: Record<string, number> = {
  Thai: 148,
  Chinese: 6,
  Japanese: 258,
  Korean: 26,
  'Sri Lankan': 46,
  Vietnamese: 192,
  Mexican: 322,
  Indian: 92,
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function cuisineColor(cuisine: string): string {
  const hue = cuisineHue[cuisine] ?? hash(cuisine) % 360
  return `hsl(${hue} 58% 44%)`
}
