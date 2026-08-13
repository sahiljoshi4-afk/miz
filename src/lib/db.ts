import Dexie, { type Table } from 'dexie'

export interface PendingCook {
  id: string
  photoBlob: Blob | null // null for note-only entries
  note: string
  cookedAt: string // ISO timestamp of capture
  status: 'draft' | 'ready'
}

class MiseDB extends Dexie {
  pendingCooks!: Table<PendingCook, string>

  constructor() {
    super('mise')
    this.version(1).stores({ pendingCooks: 'id, status' })
  }
}

export const db = new MiseDB()

export async function createDraft(photoBlob: Blob | null): Promise<string> {
  const id = crypto.randomUUID()
  await db.pendingCooks.add({
    id,
    photoBlob,
    note: '',
    cookedAt: new Date().toISOString(),
    status: 'draft',
  })
  return id
}

export async function getDraft(id: string): Promise<PendingCook | undefined> {
  return db.pendingCooks.get(id)
}

export async function saveDraft(id: string, note: string): Promise<void> {
  await db.pendingCooks.update(id, { note, status: 'ready' })
}

export async function pendingItems(): Promise<PendingCook[]> {
  return db.pendingCooks.where('status').equals('ready').toArray()
}
