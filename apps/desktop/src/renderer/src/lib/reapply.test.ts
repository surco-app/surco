import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import type { TrackItem } from '../types'
import { declickForJob, normalizeForJob } from './reapply'

const loudness: NormalizeConfig = {
  mode: 'loudness',
  targetLufs: -9,
  truePeakDb: -1,
  peakDb: -1,
}
const peak: NormalizeConfig = { mode: 'peak', peakDb: -0.3, targetLufs: -9, truePeakDb: -1 }
const none: NormalizeConfig = { mode: 'none', targetLufs: -9, truePeakDb: -1, peakDb: -1 }

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/ATB - Till I Come.mp3',
    fileName: 'ATB - Till I Come.mp3',
    listLabel: 'Till I Come',
    query: '',
    status: 'done',
    meta: {
      title: 'Till I Come',
      artist: 'ATB',
      album: '',
      albumArtist: 'ATB',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
    ...over,
  }
}

// An in-place export rewrote the source and repointed the track at it, so inputPath
// and outputPath are the same file — the one the filters were already baked into.
function exportedInPlace(over: Partial<TrackItem> = {}): TrackItem {
  return track({
    outputPath: '/music/ATB - Till I Come.mp3',
    inputPath: '/music/ATB - Till I Come.mp3',
    ...over,
  })
}

describe('normalizeForJob', () => {
  // The bug Djotas hit: normalize, export in place, then fix a tag and press Update.
  // The gain is already in the file, so re-sending the filter would run a second
  // loudnorm pass over already-normalized audio — and, worse, force a re-encode
  // where a pure tag edit could have been a stream copy (see planConversion's
  // copyOk). Nothing about the audio changed, so the job must ask for no filter.
  // Explicitly 'none' rather than absent: main falls back to the Settings default
  // when the job carries no config, which would re-apply the very filter we skip.
  it('asks for no normalization when the in-place file already has it baked in', () => {
    const t = exportedInPlace({ processedNormalize: loudness })
    expect(normalizeForJob(t, loudness)).toEqual({ ...loudness, mode: 'none' })
  })

  // Peak rides the same field and the same filter chain as loudness, so it must be
  // dropped on the same terms — the reason it re-applies is not mode-specific.
  it('asks for no normalization when a peak export is already baked in', () => {
    const t = exportedInPlace({ processedNormalize: peak })
    expect(normalizeForJob(t, peak)).toEqual({ ...peak, mode: 'none' })
  })

  // Dialing a different target is the user asking for new audio, which is exactly
  // the flow isNormalizeStale exists to protect. The measurement pass re-reads the
  // current (already-normalized) file, so applying it again lands on the new target
  // rather than stacking gain.
  it('re-applies when the user dialed a different target', () => {
    const t = exportedInPlace({ processedNormalize: loudness })
    expect(normalizeForJob(t, { ...loudness, targetLufs: -14 })).toEqual({
      ...loudness,
      targetLufs: -14,
    })
  })

  // Switching mode is a dial change like any other.
  it('re-applies when the user switched from loudness to peak', () => {
    const t = exportedInPlace({ processedNormalize: loudness })
    expect(normalizeForJob(t, peak)).toEqual(peak)
  })

  // A real conversion left the source untouched: the next export re-reads the
  // original, so the filter must go out or the copy would ship un-normalized.
  it('keeps the normalization when the export wrote a separate copy', () => {
    const t = track({ inputPath: '/music/orig.wav', outputPath: '/out/a.mp3' })
    expect(normalizeForJob({ ...t, processedNormalize: loudness }, loudness)).toEqual(loudness)
  })

  // Nothing was exported yet, so there is nothing baked in to skip.
  it('keeps the normalization for a track that was never processed', () => {
    expect(normalizeForJob(track({ status: 'idle' }), loudness)).toEqual(loudness)
  })

  // No dial set means main would fall back to the Settings default — which is the
  // very config already baked into this file, so it must still be suppressed.
  it('suppresses the Settings fallback when the file already carries that filter', () => {
    const t = exportedInPlace({ processedNormalize: loudness })
    expect(normalizeForJob(t, undefined)).toEqual({ ...loudness, mode: 'none' })
  })

  // Nothing was applied and no dial is set: the caller's fallback to Settings is the
  // right behaviour and must not be shadowed by a spurious config.
  it('passes an absent dial through on a track that was never processed', () => {
    expect(normalizeForJob(track({ status: 'idle' }), undefined)).toBeUndefined()
  })

  // 'none' is not something that gets baked in, so it never needs skipping — but it
  // must also not be mistaken for "already applied" and silently swallowed.
  it('passes mode none through untouched', () => {
    const t = exportedInPlace({ processedNormalize: none })
    expect(normalizeForJob(t, none)).toEqual(none)
  })
})

describe('declickForJob', () => {
  // Click repair alters samples exactly like the other two filters (ffmpeg.ts says
  // so where it builds the chain), so an in-place file already carries it.
  // Explicitly 'off' for the same reason normalize sends 'none': an absent config
  // would fall back to the Settings default in main and run the filter again.
  it('asks for no click repair when it is already baked into the in-place file', () => {
    const t = exportedInPlace({ processedDeclick: 'standard' })
    expect(declickForJob(t, 'standard')).toBe('off')
  })

  it('re-applies when the user changed the intensity', () => {
    const t = exportedInPlace({ processedDeclick: 'standard' })
    expect(declickForJob(t, 'strong')).toBe('strong')
  })

  it('keeps the click repair when the export wrote a separate copy', () => {
    const t = track({ inputPath: '/music/orig.wav', outputPath: '/out/a.mp3' })
    expect(declickForJob({ ...t, processedDeclick: 'standard' }, 'standard')).toBe('standard')
  })

  // 'off' means no filter ran, so it is never "already applied".
  it('passes off through untouched', () => {
    const t = exportedInPlace({ processedDeclick: 'off' })
    expect(declickForJob(t, 'off')).toBe('off')
  })
})
