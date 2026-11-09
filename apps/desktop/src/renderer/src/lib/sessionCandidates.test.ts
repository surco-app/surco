import { describe, expect, it } from 'vitest'
import type { AppleMusicTrackMeta, SourcePlaylistEntry } from '../../../shared/types'
import { type SessionSource, setSequences, toCandidates, trackIdOf } from './sessionCandidates'

function entry(
  path: string | null,
  over: Partial<SourcePlaylistEntry> = {},
  meta: AppleMusicTrackMeta = {},
): SourcePlaylistEntry {
  return { path, separator: false, meta, ...over }
}

const source = (role: SessionSource['role'], ...entries: SourcePlaylistEntry[]): SessionSource => ({
  role,
  entries,
})

describe('trackIdOf', () => {
  it('gives the same id to a path written with composed and decomposed accents', () => {
    const composed = entry('/m/Café.mp3')
    const decomposed = entry('/m/Café.mp3')
    expect(trackIdOf(composed)).toBe(trackIdOf(decomposed))
  })

  it('uses the content id when the row has one', () => {
    expect(trackIdOf(entry('/m/a.mp3', { contentId: '42' }))).toBe('42')
  })

  it('has no id for a separator or a row with neither path nor content id', () => {
    expect(trackIdOf(entry('/m/sep.mp3', { separator: true }))).toBeNull()
    expect(trackIdOf(entry(null))).toBeNull()
  })
})

describe('toCandidates', () => {
  it('makes a track in a bases playlist and a vocals playlist neutral', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3')),
      source('vocal', entry('/m/a.mp3')),
    ])
    expect(tracks.map((t) => t.role)).toEqual(['any'])
  })

  it('lets a concrete role win over a mixed playlist', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3')),
      source('any', entry('/m/a.mp3')),
    ])
    expect(tracks[0].role).toBe('base')
  })

  it('keeps one candidate per track and drops separators', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3'), entry('/m/sep.mp3', { separator: true })),
      source('any', entry('/m/a.mp3')),
    ])
    expect(tracks).toHaveLength(1)
  })

  it('marks a track only in a new-tracks playlist as fresh with the role it was given', () => {
    const tracks = toCandidates([
      { role: 'fresh', freshRole: 'vocal', entries: [entry('/m/n.mp3')] },
    ])
    expect(tracks[0]).toMatchObject({ fresh: true, role: 'vocal' })
  })

  it('does not call a track fresh when an origin playlist also holds it', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3')),
      { role: 'fresh', entries: [entry('/m/a.mp3')] },
    ])
    expect(tracks[0]).toMatchObject({ fresh: false, role: 'base' })
  })

  it('brings the tracks of a Set playlist in as neutral', () => {
    const tracks = toCandidates([source('set', entry('/m/a.mp3'), entry('/m/b.mp3'))])
    expect(tracks.map((t) => t.role)).toEqual(['any', 'any'])
  })

  it('reads key, tempo, rating, plays and duration, with zeros and null for what is missing', () => {
    const [full, bare] = toCandidates([
      source(
        'any',
        entry(
          '/m/a.mp3',
          { preview: { title: 'Secret', artist: 'Absolom', durationSec: 408, cues: [] } },
          { key: 'Am', bpm: '138.07', rating: 80, playCount: 12 },
        ),
        entry('/m/b.mp3', {}, { key: '', bpm: 'x' }),
      ),
    ])
    expect(full).toMatchObject({
      key: '8A',
      bpm: 138.07,
      rating: 80,
      plays: 12,
      secs: 408,
      title: 'Secret',
      artist: 'Absolom',
    })
    expect(bare).toMatchObject({ key: null, bpm: 0, rating: 0, plays: 0, secs: 0 })
  })

  it('falls back to the file name for the title when the row has no preview', () => {
    const [track] = toCandidates([source('any', entry('/m/Do It Now.wav'))])
    expect(track.title).toBe('Do It Now')
  })
})

describe('setSequences', () => {
  it('lists the ids of each Set playlist in order and ignores other roles', () => {
    const sequences = setSequences([
      source('set', entry('/m/a.mp3'), entry('/m/b.mp3'), entry('/m/c.mp3')),
      source('base', entry('/m/x.mp3'), entry('/m/y.mp3')),
    ])
    expect(sequences).toEqual([['/m/a.mp3', '/m/b.mp3', '/m/c.mp3']])
  })

  it('cuts the sequence at a separator so the two sides are not taken as a pair', () => {
    const sequences = setSequences([
      source('set', entry('/m/a.mp3'), entry('/m/sep.mp3', { separator: true }), entry('/m/b.mp3')),
    ])
    expect(sequences).toEqual([['/m/a.mp3'], ['/m/b.mp3']])
  })
})
