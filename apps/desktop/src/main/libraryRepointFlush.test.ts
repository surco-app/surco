import { describe, expect, it } from 'vitest'
import { flushLibraryRepoints, type RepointKeys } from './libraryRepointFlush'

const KEYS: RepointKeys = {
  step: 'step',
  written: 'written',
  skipped: 'skipped',
  nothing: 'nothing',
  running: 'running',
  backupFailed: 'backupFailed',
  readOnly: 'readOnly',
  unreadable: 'unreadable',
  writeFailed: 'writeFailed',
  runningReason: 'app-running',
}

describe('flushLibraryRepoints', () => {
  // Name changes are not repoints and have no `to`; the caller says what names the track.
  it('names a skipped item with the label the caller gives', async () => {
    const result = await flushLibraryRepoints(
      {
        collectionPath: '/c',
        endBatch: () => [{ path: '/m/a.mp3' }],
        repointTracks: async () => [{ written: false, reason: 'ambiguous' }],
        labelOf: (item: { path: string }) => item.path,
      },
      KEYS,
    )
    expect(result.skipped).toEqual([{ track: '/m/a.mp3', reason: 'ambiguous' }])
  })
})
