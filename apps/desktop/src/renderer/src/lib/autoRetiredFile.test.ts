import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { autoRetiredFile } from './autoRetiredFile'

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
