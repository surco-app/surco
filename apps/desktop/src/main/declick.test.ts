import { describe, expect, it } from 'vitest'
import {
  declickRemovedArgs,
  parseDeclickedSamples,
  parseDeclickedShare,
  PREVIEW_SECONDS,
  previewWindow,
} from './declick'

// declickFilter itself (modes, sensitivity mapping, safety clamps) is covered in
// shared/declick.test.ts — it moved to shared so the renderer can show the exact
// applied filter string.

describe('previewWindow', () => {
  it('centers the excerpt on the middle of a long track', () => {
    expect(previewWindow(300)).toEqual({ start: 150 - PREVIEW_SECONDS / 2, length: PREVIEW_SECONDS })
  })

  it('takes a short track whole from the start', () => {
    expect(previewWindow(12)).toEqual({ start: 0, length: PREVIEW_SECONDS })
  })

  it('treats an unknown duration like a short track, never seeking blind', () => {
    expect(previewWindow(null)).toEqual({ start: 0, length: PREVIEW_SECONDS })
  })
})

describe('declickRemovedArgs', () => {
  it('renders the difference between the source and its repair — the removed clicks alone', () => {
    const args = declickRemovedArgs(
      '/in.wav',
      '/out.wav',
      { mode: 'strong', sensitivity: 5 },
      { start: 140, length: 20 },
    )
    expect(args?.join(' ')).toContain(
      '[0:a]asplit=2[a][b];[a]adeclick=b=4,volume=-1[inv];[b][inv]amix=inputs=2:normalize=0[d]',
    )
    // Input-side seek so the excerpt decodes fast, and a WAV the <audio> element plays.
    expect(args?.join(' ')).toContain('-ss 140 -t 20 -i /in.wav')
    expect(args?.slice(-2)).toEqual(['pcm_s16le', '/out.wav'])
  })

  it('has nothing to render when the repair is off', () => {
    expect(
      declickRemovedArgs(
        '/in.wav',
        '/out.wav',
        { mode: 'off', sensitivity: 5 },
        { start: 0, length: 20 },
      ),
    ).toBeNull()
  })
})

describe('parseDeclickedSamples', () => {
  it('reads the repaired-sample count adeclick prints at stream end', () => {
    const stderr = [
      'size=     861kB time=00:00:09.99 bitrate= 706.4kbits/s speed= 121x',
      '[Parsed_adeclick_0 @ 0x600003084580] Detected clicks in 234 of 441000 samples (0.0530612%).',
    ].join('\n')
    expect(parseDeclickedSamples(stderr)).toBe(234)
  })

  it('sums the counts when the filter reports more than one line', () => {
    const stderr = [
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 100 of 441000 samples (0.02%).',
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 34 of 441000 samples (0.007%).',
    ].join('\n')
    expect(parseDeclickedSamples(stderr)).toBe(134)
  })

  it('returns null when the encode ran without the filter, so 0 repaired and not-run stay distinct', () => {
    expect(parseDeclickedSamples('size= 861kB time=00:00:09.99')).toBeNull()
  })

  it('reads a clean run as zero, not as missing', () => {
    expect(
      parseDeclickedSamples('[Parsed_adeclick_0 @ 0x1] Detected clicks in 0 of 441000 samples (0%).'),
    ).toBe(0)
  })
})

describe('parseDeclickedShare', () => {
  it('reads the touched share of the stream, for the audition caption', () => {
    expect(
      parseDeclickedShare(
        '[Parsed_adeclick_0 @ 0x1] Detected clicks in 111919 of 1764000 samples (6.34461%).',
      ),
    ).toBeCloseTo(111919 / 1764000)
  })

  it('ignores the empty flush line the filter sometimes prints first', () => {
    const stderr = [
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 0 of 0 samples (nan%).',
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 234 of 441000 samples (0.05%).',
    ].join('\n')
    expect(parseDeclickedShare(stderr)).toBeCloseTo(234 / 441000)
  })

  it('returns null when the filter reported nothing usable', () => {
    expect(parseDeclickedShare('size= 861kB')).toBeNull()
    expect(
      parseDeclickedShare('[Parsed_adeclick_0 @ 0x1] Detected clicks in 0 of 0 samples (nan%).'),
    ).toBeNull()
  })
})
