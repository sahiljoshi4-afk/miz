import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { db } from './db'
import { flushPending } from './queue'

function mockClient(overrides: Partial<Record<keyof SupabaseClient, unknown>> = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-1' } } }) },
    storage: {
      from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }),
    },
    rpc: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  } as unknown as SupabaseClient
}

beforeEach(async () => {
  await db.pendingCooks.clear()
})

describe('flushPending', () => {
  it('uploads, calls create_cook, and removes the row on success', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: 'dal', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient()
    const flushed = await flushPending(client)
    expect(flushed).toBe(1)
    expect(client.storage.from).toHaveBeenCalledWith('cooks')
    expect(client.rpc).toHaveBeenCalledWith('create_cook', {
      p_cook_id: 'cook-1',
      p_cooked_at: '2026-08-12T19:00:00Z',
      p_note: 'dal',
      p_storage_path: 'owner-1/cook-1/1.jpg',
    })
    expect(await db.pendingCooks.count()).toBe(0)
  })

  it('does nothing when there is no session', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    expect(await flushPending(client)).toBe(0)
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('keeps the row when upload fails', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ error: { message: 'offline' } }),
        }),
      },
    })
    expect(await flushPending(client)).toBe(0)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('keeps the row when the rpc fails (retry is idempotent)', async () => {
    await db.pendingCooks.add({
      id: 'cook-1', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'ready',
    })
    const client = mockClient({
      rpc: vi.fn().mockResolvedValue({ error: { message: 'network' } }),
    })
    expect(await flushPending(client)).toBe(0)
    expect(await db.pendingCooks.count()).toBe(1)
  })

  it('skips draft rows', async () => {
    await db.pendingCooks.add({
      id: 'cook-2', photoBlob: new Blob(['x']), note: '', cookedAt: '2026-08-12T19:00:00Z', status: 'draft',
    })
    expect(await flushPending(mockClient())).toBe(0)
  })
})
