import { describe, expect, it } from 'vitest'
import { processesAudio, tagsOnly } from './audioProcessing'

const loudness = { mode: 'loudness' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }

describe('tagsOnly', () => {
  // The label promises "Update tags" and main stream-copies on the same rule: any filter
  // that re-renders the samples turns a same-format export into a re-encode.
  it('is a tag update only in the same format with no filter staged', () => {
    expect(tagsOnly(true, {})).toBe(true)
    expect(tagsOnly(true, { normalize: { ...loudness, mode: 'none' }, declick: 'off' })).toBe(true)
    expect(tagsOnly(false, {})).toBe(false)
    expect(tagsOnly(true, { normalize: loudness })).toBe(false)
    expect(tagsOnly(true, { declick: 'soft' })).toBe(false)
    expect(tagsOnly(true, { trim: { endSec: 90 } })).toBe(false)
  })

  it('ignores a trim that cuts nothing, as the conversion does', () => {
    expect(processesAudio({ trim: {} })).toBe(false)
  })
})
