import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { buildM3u } from './m3u'

function track(id: string, meta: Partial<TrackMetadata> = {}, extra: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
    ...extra,
  }
}

describe('buildM3u', () => {
  // The whole point of the extended header: players show "Artist - Title" and the
  // length instead of a bare file path.
  it('writes the extended header with duration and artist - title per track', () => {
    const out = buildM3u([track('a', { title: 'Strobe', artist: 'deadmau5' }, { duration: 634.6 })])
    expect(out.startsWith('#EXTM3U\n')).toBe(true)
    expect(out).toContain('#EXTINF:635,deadmau5 - Strobe\n/music/a.wav\n')
  })

  // Like every other export, the converted copy is the file the playlist should point
  // at when it exists — the original otherwise.
  it('prefers the converted file over the source', () => {
    const out = buildM3u([track('a', { title: 'T' }, { outputPath: '/out/a.aiff' })])
    expect(out).toContain('/out/a.aiff')
    expect(out).not.toContain('/music/a.wav')
  })

  // A track with no probed duration still plays; -1 is the format's "unknown".
  it('marks an unknown duration as -1 and falls back to the list label', () => {
    const out = buildM3u([track('a')])
    expect(out).toContain('#EXTINF:-1,a\n')
  })
})
