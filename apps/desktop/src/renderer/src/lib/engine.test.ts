import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { buildEnginePayload } from './engine'

const track = (
  over: Omit<Partial<TrackItem>, 'meta'> & { meta?: Partial<TrackMetadata> },
): TrackItem =>
  ({
    id: over.id ?? 'x',
    inputPath: over.inputPath ?? '/music/x.wav',
    fileName: over.fileName ?? 'x.wav',
    outputPath: over.outputPath,
    duration: over.duration,
    meta: {
      title: '',
      artist: '',
      album: '',
      genre: '',
      comment: '',
      bpm: '',
      year: '',
      ...over.meta,
    },
  }) as TrackItem

describe('buildEnginePayload', () => {
  it('maps a track to the Engine export payload', () => {
    const [p] = buildEnginePayload([
      track({
        inputPath: '/music/song.mp3',
        duration: 200,
        meta: { title: 'Song', artist: 'Artist', bpm: '128', year: '1999' },
      }),
    ])
    expect(p).toEqual({
      path: '/music/song.mp3',
      title: 'Song',
      artist: 'Artist',
      album: '',
      genre: '',
      comment: '',
      bpm: '128',
      year: '1999',
      durationSec: 200,
    })
  })

  it('references the converted output over the source when present', () => {
    const [p] = buildEnginePayload([track({ inputPath: '/in/a.wav', outputPath: '/out/a.aiff' })])
    expect(p.path).toBe('/out/a.aiff')
  })

  it('falls back to the file name when the title tag is empty', () => {
    const [p] = buildEnginePayload([track({ fileName: 'untitled.wav', meta: { title: '' } })])
    expect(p.title).toBe('untitled.wav')
  })
})
