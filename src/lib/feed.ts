export interface FeedItem {
  id: string
  cookedAt: string
  note: string
  photoUrl: string | null
  syncError?: string
}
