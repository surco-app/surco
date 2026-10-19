import { describe, expect, it } from 'vitest'
import { HOT_CUE_DEFAULT_COLOR, hotCueColor, MEMORY_CUE_COLOR } from './rekordboxCueColors'

describe('rekordbox cue colours', () => {
  it('paints the four countdown colours as rekordbox shows them', () => {
    expect(hotCueColor(1)).toBe('#305aff')
    expect(hotCueColor(22)).toBe('#28e214')
    expect(hotCueColor(32)).toBe('#c3af04')
    expect(hotCueColor(42)).toBe('#e62828')
  })

  it('covers rekordbox whole table, first to last', () => {
    expect(hotCueColor(2)).toBe('#5073ff')
    expect(hotCueColor(62)).toBe('#6473ff')
  })

  it('falls back to rekordbox default for a cue with no colour or an unknown index', () => {
    expect(hotCueColor(null)).toBe(HOT_CUE_DEFAULT_COLOR)
    expect(hotCueColor(0)).toBe(HOT_CUE_DEFAULT_COLOR)
    expect(hotCueColor(63)).toBe(HOT_CUE_DEFAULT_COLOR)
  })

  it('draws memory cues red, as rekordbox does', () => {
    expect(MEMORY_CUE_COLOR).toBe('#e62828')
  })
})
