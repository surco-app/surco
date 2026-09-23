import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
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
    // What the file itself carried at import: a different title, so the track above
    // reads as edited unless a test overrides this to match.
    diskSignature: trackSignature({ meta: { title: 'Disk' } as TrackItem['meta'] }),
    ...over,
  }
}

describe('sessionEdits', () => {
  // The snapshot the crash recovery restores: everything editable, keyed by the
  // source path (the only identity that survives a relaunch — track ids are minted
  // fresh every import).
  it('captures each edited track’s state keyed by its source path', () => {
    const edits = sessionEdits([
      track(),
      track({ id: 'id-2', inputPath: '/music/b.wav', outputName: 'B1 - Other' }),
    ])
    expect(Object.keys(edits)).toEqual(['/music/a.wav', '/music/b.wav'])
    expect(edits['/music/a.wav'].meta.title).toBe('Edited')
    expect(edits['/music/b.wav'].outputName).toBe('B1 - Other')
  })

  // "Is there anything to lose?" is answered by the edits map alone: a track whose
  // editable state still matches what the file carries restores identically from the
  // file itself, so it stays out — an all-clean session saves an empty map, which is
  // what lets the reopen offer keep its auto-expiring countdown.
  it('skips tracks whose state matches the file on disk', () => {
    const clean = track()
    clean.diskSignature = trackSignature(clean)
    expect(sessionEdits([clean])).toEqual({})
  })

  // A row whose disk snapshot never landed (the read failed before stamping) has
  // nothing to compare against; counting it as edited would make every such save
  // claim there is work to lose.
  // The batch honours each track's own loudness and click-repair dials, so a relaunch that
  // forgot them converted every track with the defaults instead. They are not part of the
  // disk signature (turning a dial must not flip a converted track stale), so a track whose
  // only change is a dial still has to be saved.
  it('saves the per-track loudness and click repair, even on an otherwise clean track', () => {
    const normalize = {
      mode: 'loudness' as const,
      targetLufs: -9,
      truePeakDb: -1,
      peakDb: -0.3,
    }
    const clean = track({ normalize, declick: 'strong' })
    clean.diskSignature = trackSignature(clean)
    const edits = sessionEdits([clean])
    expect(edits['/music/a.wav'].normalize).toEqual(normalize)
    expect(edits['/music/a.wav'].declick).toBe('strong')
  })

  it('skips tracks with no disk snapshot', () => {
    expect(sessionEdits([track({ diskSignature: undefined })])).toEqual({})
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
        matchProvider: 'discogs',
        trim: { startSec: 3.2, endSec: 200 },
      }),
    ])
    expect(edits['/music/a.wav']).toMatchObject({
      coverUrl: 'https://i.discogs.com/cover.jpg',
      matched: true,
      autoMatched: true,
      matchConfidence: 0.92,
      matchProvider: 'discogs',
      trim: { startSec: 3.2, endSec: 200 },
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

  // A per-tag delete staged in the inspector must survive a crash/reopen exactly like
  // metaCleared does — otherwise a restored session silently forgets which foreign
  // tags the user marked for removal.
  it('remembers foreign tags marked for removal', () => {
    const edits = sessionEdits([track({ foreignRemoved: ['SERATO_MARKERS_V2'] })])
    expect(edits['/music/a.wav'].foreignRemoved).toEqual(['SERATO_MARKERS_V2'])
  })

  // Reported 14/09: after a reopen the button said "Add" instead of "Update" for a track
  // that IS in the library, which risks a second copy of the same song. The persistent ID
  // is what tells Surco to sync the existing copy rather than import a new one, and it was
  // dropped on save — so the reopened row had no idea the track was already there.
  it('remembers which library copy a track belongs to', () => {
    const edits = sessionEdits([track({ musicPersistentId: 'PID1' })])
    expect(edits['/music/a.wav'].musicPersistentId).toBe('PID1')
  })

  // Coming from a playlist is not a cosmetic flag: it makes the conversion keep the
  // source's own format unless the user picks another (see resolveJobFormat). Losing it on
  // reopen quietly turned the user's WAVs into their default output format.
  it('remembers that a track came from a playlist import', () => {
    const edits = sessionEdits([track({ fromAppleMusic: true })])
    expect(edits['/music/a.wav'].fromAppleMusic).toBe(true)
  })

  // A loose file has neither, and storing absent flags would only bloat the file.
  it('stores nothing about the library for a track that has no copy', () => {
    const edits = sessionEdits([track({})])
    expect(edits['/music/a.wav'].musicPersistentId).toBeUndefined()
    expect(edits['/music/a.wav'].fromAppleMusic).toBeUndefined()
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
