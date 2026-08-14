import { describe, expect, it } from 'vitest'
import { chunk } from './backfill-client'

describe('chunk', () => {
  it('splits into size-3 batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([[1, 2, 3], [4, 5]])
  })
  it('handles empty input', () => {
    expect(chunk([], 3)).toEqual([])
  })
})
