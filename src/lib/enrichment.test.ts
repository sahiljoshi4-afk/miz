import { describe, expect, it } from 'vitest'
import { modelForCook } from './enrichment'

describe('modelForCook', () => {
  it('uses haiku for backfill rows', () => {
    expect(modelForCook({ source: 'backfill' })).toBe('claude-haiku-4-5')
  })
  it('uses sonnet for own rows and legacy nulls', () => {
    expect(modelForCook({ source: 'own' })).toBe('claude-sonnet-5')
    expect(modelForCook({ source: null })).toBe('claude-sonnet-5')
  })
})
