import { describe, expect, it } from 'vitest'
import { FINGERPRINT_NAMESPACE, LOUDNESS_NAMESPACE, WAVEFORM_NAMESPACE } from './analysisCache'
import { AUDIO_ONLY_NAMESPACES } from './carriedAnalysis'

describe('AUDIO_ONLY_NAMESPACES', () => {
  it('never carries a tag read, which would show the old comment', () => {
    expect(AUDIO_ONLY_NAMESPACES.filter((ns) => ns.startsWith('readmeta'))).toEqual([])
  })

  it('carries the measurements that only depend on the audio', () => {
    expect(AUDIO_ONLY_NAMESPACES).toEqual(
      expect.arrayContaining([
        LOUDNESS_NAMESPACE,
        WAVEFORM_NAMESPACE,
        FINGERPRINT_NAMESPACE,
        'spectrogram-mono-v31',
      ]),
    )
  })

  it('carries the tempo, key, beat grid and remembered auto-match so a comment save never measures the track again', () => {
    expect(AUDIO_ONLY_NAMESPACES).toEqual(
      expect.arrayContaining(['bpm', 'key', 'beat-grid-v4', 'automatch-v1']),
    )
  })
})
