import { describe, expect, it } from 'vitest'
import {
  HOT_CUE_DEFAULT_COLOR,
  HOT_CUE_DEFAULT_INDEX,
  HOT_CUE_PICKER,
  hotCueArgb,
  hotCueColor,
  MEMORY_CUE_COLOR,
  nearestHotCueColor,
} from './rekordboxCueColors'

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

  it('offers the 16 colours of rekordbox picker, the four of the countdown among them', () => {
    expect(HOT_CUE_PICKER).toHaveLength(16)
    expect(HOT_CUE_PICKER).toEqual(expect.arrayContaining([1, 22, 32, 42]))
    expect(new Set(HOT_CUE_PICKER.map(hotCueColor)).size).toBe(16)
  })

  it('lays the colours out as rekordbox picker does, four rows from the pinks to the reds', () => {
    expect(HOT_CUE_PICKER).toEqual([48, 52, 56, 60, 1, 5, 9, 14, 18, 22, 26, 30, 32, 38, 42, 45])
  })

  it('gives a new hot cue the colour rekordbox draws a cue without one', () => {
    expect(hotCueColor(HOT_CUE_DEFAULT_INDEX)).toBe(HOT_CUE_DEFAULT_COLOR)
  })

  it('writes each colour to Engine DJ as the opaque ARGB of the same swatch, so the pad lights as Surco drew it', () => {
    expect(hotCueArgb(22)).toBe(0xff28e214)
    expect(hotCueArgb(1)).toBe(0xff305aff)
    expect(hotCueArgb(null)).toBe(0xff28e214)
  })

  it('reads every colour Surco writes back as the same index, so an untouched cue never looks recoloured', () => {
    for (let index = 1; index <= 62; index++)
      expect(nearestHotCueColor(hotCueArgb(index))).toBe(index)
  })

  it('reads an Engine DJ pad colour as the closest swatch of the table, since Engine has its own palette', () => {
    expect(nearestHotCueColor(0xfff4d338)).toBe(33)
    expect(nearestHotCueColor(0xffef8130)).toBe(38)
  })
})
