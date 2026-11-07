import { afterEach, describe, expect, it } from 'vitest'
import { markOwnRemovals, takeOwnRemoval } from './ownRemovals'

afterEach(() => {
  takeOwnRemoval('a')
  takeOwnRemoval('b')
})

describe('ownRemovals', () => {
  it('answers once for an id Surco itself removed, and never for another', () => {
    markOwnRemovals(['a', 'b'])
    expect(takeOwnRemoval('a')).toBe(true)
    expect(takeOwnRemoval('a')).toBe(false)
    expect(takeOwnRemoval('c')).toBe(false)
  })
})
