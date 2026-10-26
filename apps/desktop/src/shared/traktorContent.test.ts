import { describe, expect, it } from 'vitest'
import { isTraktorContent, traktorContentId, traktorKey } from './traktorContent'

describe('traktorContent', () => {
  it('gives back the collection key a content id was made from, characters and all', () => {
    expect(traktorKey(traktorContentId('HD/:Music/:a & b.mp3'))).toBe('HD/:Music/:a & b.mp3')
  })

  it('never takes an Engine DJ id for a Traktor one', () => {
    expect(isTraktorContent('engine:3')).toBe(false)
    expect(traktorKey('engine:3')).toBeNull()
  })
})
