import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { autoRetiredFile, retireDecision } from './autoRetiredFile'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/lib/new/A.wav',
    fileName: 'A.wav',
    listLabel: 'A.wav',
    query: '',
    status: 'done',
    meta: {},
    musicStatus: 'added',
    verification: { status: 'ok', checks: [] },
    supersededPath: '/lib/old/03 A.aiff',
    ...over,
  } as TrackItem
}

describe('autoRetiredFile', () => {
  it('retires the file a format change superseded in Apple Music, since converting to another format means the old one is no longer wanted', () => {
    expect(autoRetiredFile(track())).toBe('/lib/old/03 A.aiff')
  })

  it('retires the source the old Music entry played when the output folder keeps a copy, the Mac default, which otherwise stays orphaned beside nothing', () => {
    expect(
      autoRetiredFile(
        track({
          inputPath: '/lib/old/03 A.aiff',
          outputPath: '/out/A.wav',
          supersededPath: '/lib/old/03 A.aiff',
        }),
      ),
    ).toBe('/lib/old/03 A.aiff')
  })

  it('retires the library copy a replacement stamped, when it was in another format', () => {
    expect(
      autoRetiredFile(
        track({
          inputPath: '/downloads/A.flac',
          outputPath: '/out/A.aiff',
          supersededPath: undefined,
          replacesPath: '/lib/A.mp3',
        }),
      ),
    ).toBe('/lib/A.mp3')
  })

  it('keeps a superseded file in the same format, since only a format change was asked to retire it', () => {
    expect(
      autoRetiredFile(
        track({
          inputPath: '/downloads/A.wav',
          outputPath: '/out/A.wav',
          supersededPath: undefined,
          replacesPath: '/lib/A.wav',
        }),
      ),
    ).toBeNull()
    expect(autoRetiredFile(track({ inputPath: '/lib/new/A.aif' }))).toBeNull()
  })

  it.each(['checking', 'pending', 'mismatch'] as const)(
    'keeps the old file while the check is %s, since it is the only trusted copy until every place agrees',
    (status) => {
      expect(autoRetiredFile(track({ verification: { status, checks: [] } }))).toBeNull()
    },
  )

  it('keeps the old file when the conversion was never re-read', () => {
    expect(autoRetiredFile(track({ verification: undefined }))).toBeNull()
  })

  it('keeps the old file until the conversion has finished', () => {
    expect(autoRetiredFile(track({ status: 'processing' }))).toBeNull()
    expect(autoRetiredFile(track({ status: 'error' }))).toBeNull()
  })

  it('keeps the old file while the old Music entry may still play it', () => {
    expect(autoRetiredFile(track({ musicStatus: 'error' }))).toBeNull()
    expect(autoRetiredFile(track({ oldMusicCopyKept: 'carry' }))).toBeNull()
  })

  it('keeps a replaced Music copy whose entry this run never re-read, since Music may still play it', () => {
    const replacement = {
      inputPath: '/downloads/A.flac',
      outputPath: '/out/A.aiff',
      supersededPath: undefined,
      replacesPath: '/lib/A.mp3',
      musicPersistentId: 'P1',
    }
    expect(autoRetiredFile(track(replacement))).toBeNull()
    expect(
      autoRetiredFile(
        track({
          ...replacement,
          verification: {
            status: 'ok',
            checks: [{ place: 'appleMusic', state: 'ok', detail: { key: 'musicOne' } }],
          },
        }),
      ),
    ).toBe('/lib/A.mp3')
  })

  it('stops once main kept the file for a library that still uses it, so the manual offer takes over', () => {
    expect(autoRetiredFile(track({ supersededKept: true }))).toBeNull()
  })

  it('does not retire a file twice', () => {
    expect(autoRetiredFile(track({ supersededTrashed: true }))).toBeNull()
    expect(
      autoRetiredFile(
        track({
          inputPath: '/lib/old/03 A.aiff',
          outputPath: '/out/A.wav',
          originalTrashed: true,
        }),
      ),
    ).toBeNull()
  })

  it('never retires the file the track now points at', () => {
    expect(autoRetiredFile(track({ supersededPath: '/lib/new/A.wav' }))).toBeNull()
  })

  it('retires nothing when the conversion replaced no copy', () => {
    expect(
      autoRetiredFile(track({ supersededPath: undefined, outputPath: '/out/A.wav' })),
    ).toBeNull()
  })
})

// Converting Do it.aiff to WAV on 01/11 left the AIFF behind, and nothing said why: the
// decision kept no trace. Every original a format change should retire and does not now
// carries its reason, so the next one can be read in the log.
describe('retireDecision', () => {
  it('names the check that did not come back ok', () => {
    expect(
      retireDecision(
        track({
          verification: {
            status: 'mismatch',
            checks: [
              { place: 'appleMusic', state: 'mismatch', detail: { key: 'musicPlaylistLost' } },
            ],
          },
        }),
      ),
    ).toEqual({
      keep: '/lib/old/03 A.aiff',
      reason: 'the check came back mismatch: appleMusic musicPlaylistLost',
    })
  })

  it('names an old Music entry that had to be kept', () => {
    expect(retireDecision(track({ oldMusicCopyKept: 'carry' }))).toEqual({
      keep: '/lib/old/03 A.aiff',
      reason: 'Apple Music kept the old entry (carry)',
    })
  })

  it('says nothing while the check is still running', () => {
    expect(retireDecision(track({ verification: { status: 'checking', checks: [] } }))).toBeNull()
  })

  it('says nothing for an original in the same format, which is never retired on its own', () => {
    expect(retireDecision(track({ supersededPath: '/lib/old/03 A.wav' }))).toBeNull()
  })

  it('retires what the checks cleared', () => {
    expect(retireDecision(track())).toEqual({ retire: '/lib/old/03 A.aiff' })
  })
})
