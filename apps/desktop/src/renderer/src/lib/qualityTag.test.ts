import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { SpectrumVerdict } from '../../../shared/types'
import { withCachedQualityTag, withQualityTag } from './qualityTag'

const analyzed = (over: Partial<SpectrumVerdict> = {}): SpectrumVerdict => ({
  cutoffHz: 21000,
  sampleRateHz: 44100,
  processed: false,
  hasKnee: false,
  ...over,
})

const meta = { ...emptyMetadata(), title: 'Pray', quality: 'Doubtful' }

describe('withQualityTag', () => {
  // The word goes into other programs' columns and crates, so it is the list's own word in
  // English whatever the app language: a Spanish "Calidad baja" would not match a crate
  // rule another machine wrote in English.
  it.each([
    ['Good', '/a.flac', analyzed()],
    ['Doubtful', '/a.mp4', analyzed({ cutoffHz: 18600, hasKnee: true })],
    ['Low quality', '/a.mp4', analyzed({ cutoffHz: 16000, hasKnee: true })],
    ['Reprocessed', '/a.flac', analyzed({ processed: true })],
    ['Lossy', '/a.flac', analyzed({ cutoffHz: 16000, hasKnee: true })],
    ['Damaged', '/a.flac', analyzed({ damaged: true })],
  ])('writes "%s" for the verdict the list shows', (word, inputPath, spectrum) => {
    expect(withQualityTag(meta, { inputPath, spectrum }, true).quality).toBe(word)
  })

  // Off by default: other users must not find a new tag in their files after an update.
  it('leaves the field as the file had it while its Auto is off', () => {
    expect(withQualityTag(meta, { inputPath: '/a.flac', spectrum: analyzed() }, false)).toBe(meta)
  })

  // With no verdict there is nothing true to write, and blanking would erase a value the
  // file already carries for the same audio.
  it.each([
    ['not analyzed yet', undefined],
    ['analyzed without a cutoff', analyzed({ cutoffHz: null })],
  ])('keeps the file value when the track is %s', (_, spectrum) => {
    expect(withQualityTag(meta, { inputPath: '/a.flac', spectrum }, true).quality).toBe('Doubtful')
  })
})

describe('withCachedQualityTag', () => {
  // The file-name builders and the job hold the cache, not the verdict: a {quality} name
  // and the tag the same save writes must read the same analysis.
  it('reads the verdict the list shows and honours the saved Auto choice', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrumVerdict', '/a.flac'], analyzed({ processed: true }))
    const track = { inputPath: '/a.flac' }
    expect(withCachedQualityTag(meta, track, client, ['quality']).quality).toBe('Reprocessed')
    expect(withCachedQualityTag(meta, track, client, undefined).quality).toBe('Doubtful')
  })
})
