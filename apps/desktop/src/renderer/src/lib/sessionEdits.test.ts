import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { sessionEdits } from './sessionEdits'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'id-1',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
    query: '',
    listLabel: 'a',
    status: 'idle',
    meta: {
      title: 'Edited',
      artist: 'Someone',
      album: '',
      albumArtist: '',
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

describe('sessionEdits', () => {
  // The snapshot the crash recovery restores: everything editable, keyed by the
  // source path (the only identity that survives a relaunch — track ids are minted
  // fresh every import).
  it('captures each track’s editable state keyed by its source path', () => {
    const edits = sessionEdits([
      track(),
      track({ id: 'id-2', inputPath: '/music/b.wav', outputName: 'B1 - Other' }),
    ])
    expect(Object.keys(edits)).toEqual(['/music/a.wav', '/music/b.wav'])
    expect(edits['/music/a.wav'].meta.title).toBe('Edited')
    expect(edits['/music/b.wav'].outputName).toBe('B1 - Other')
  })

  // Release art lives at a stable https URL, so it can come straight back after a
  // relaunch; the match flags ride along so the auto-match sweep doesn't re-probe a
  // restored track and overwrite what the restore just brought back.
  it('keeps https cover URLs and the match flags', () => {
    const edits = sessionEdits([
      track({
        coverUrl: 'https://i.discogs.com/cover.jpg',
        matched: true,
        autoMatched: true,
        matchConfidence: 0.92,
      }),
    ])
    expect(edits['/music/a.wav']).toMatchObject({
      coverUrl: 'https://i.discogs.com/cover.jpg',
      matched: true,
      autoMatched: true,
      matchConfidence: 0.92,
    })
  })

  // blob: URLs die with the renderer, and the embedded-art data: thumb both re-derives
  // from the file and would balloon the session file if persisted per track — neither
  // belongs on disk. A picked cover keeps its file path; main re-mints its preview.
  it('drops blob: and data: cover URLs but keeps the cover file path', () => {
    const edits = sessionEdits([
      track({ coverUrl: 'blob:app://abc', coverPath: '/tmp/picked.png' }),
      track({ id: 'id-2', inputPath: '/music/b.wav', coverUrl: 'data:image/jpeg;base64,xyz' }),
    ])
    expect(edits['/music/a.wav'].coverUrl).toBeUndefined()
    expect(edits['/music/a.wav'].coverPath).toBe('/tmp/picked.png')
    expect(edits['/music/b.wav'].coverUrl).toBeUndefined()
  })

  // A deliberately cleared cover must restore as cleared — bringing the embedded art
  // back would undo the user's removal.
  it('remembers a removed cover', () => {
    const edits = sessionEdits([track({ coverRemoved: true })])
    expect(edits['/music/a.wav'].coverRemoved).toBe(true)
  })

  // Transient per-session state (conversion status, analysis verdicts, review
  // suggestions) re-derives on import; persisting it would only bloat the file.
  it('stores only the editable fields', () => {
    const edits = sessionEdits([
      track({ status: 'done', outputPath: '/out/a.aiff', processedSignature: 'sig' }),
    ])
    expect(edits['/music/a.wav']).toEqual({
      meta: expect.objectContaining({ title: 'Edited' }),
    })
  })
})
