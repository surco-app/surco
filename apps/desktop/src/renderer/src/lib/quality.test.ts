import { describe, expect, it } from 'vitest'
import { formatKHz, isLowResCover, MIN_COVER_PX, qualityVerdict } from './quality'

describe('qualityVerdict', () => {
  it('passes a track whose energy reaches near Nyquist as good', () => {
    expect(qualityVerdict(19961, 44100)).toBe('good')
  })

  it('flags a brick-walled cutoff (MP3 hidden in a WAV) as suspect', () => {
    expect(qualityVerdict(15500, 44100)).toBe('suspect')
    expect(qualityVerdict(17000, 44100)).toBe('suspect')
  })

  it('uses the file Nyquist, so the bar scales with sample rate', () => {
    expect(qualityVerdict(21000, 48000)).toBe('good')
    expect(qualityVerdict(19000, 48000)).toBe('suspect')
  })

  it('treats an unknown sample rate as suspect rather than dividing by zero', () => {
    expect(qualityVerdict(20000, 0)).toBe('suspect')
  })
})

describe('formatKHz', () => {
  it('renders hertz as a one-decimal kHz label for the UI', () => {
    expect(formatKHz(19961)).toBe('20.0 kHz')
    expect(formatKHz(16000)).toBe('16.0 kHz')
  })
})

describe('isLowResCover', () => {
  // Discogs usually serves 600px art, but some releases only have a small thumb;
  // the smaller side is what limits how sharp the embedded cover can look.
  it('flags artwork whose smaller side is below the minimum', () => {
    expect(isLowResCover(255, 255)).toBe(true)
    expect(isLowResCover(600, 300)).toBe(true)
  })

  it('passes artwork at or above the minimum on both sides', () => {
    expect(isLowResCover(MIN_COVER_PX, MIN_COVER_PX)).toBe(false)
    expect(isLowResCover(600, 600)).toBe(false)
  })

  // Dimensions aren't known until the image loads; treat 0 as "unknown", not low.
  it('does not flag unknown (zero) dimensions', () => {
    expect(isLowResCover(0, 0)).toBe(false)
  })
})
