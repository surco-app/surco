import { describe, expect, it, vi } from 'vitest'
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
  collectionMissing: 'collectionMissing',
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

  // Reported 08/10: a configured rekordbox path to a deleted copy made the flush return
  // early with nothing, so the review applied everywhere else and rekordbox looked fine.
  describe('a library that is on but whose collection is not there', () => {
    const missing = async (track?: Parameters<typeof flushLibraryRepoints>[0]['track']) => {
      let detail: unknown
      const repointTracks = vi.fn(async () => [])
      const result = await flushLibraryRepoints(
        {
          collectionPath: '',
          collectionMissing: true,
          endBatch: () => [{ path: '/m/a.mp3' }],
          repointTracks,
          track:
            track ??
            (async (_kind, _key, task, opts) => {
              const r = await task()
              detail = opts?.summary?.(r)
              return r
            }),
        },
        KEYS,
      )
      return { result, detail, repointTracks }
    }

    it('says so in the Activity row instead of returning silently', async () => {
      const { result, detail, repointTracks } = await missing()
      expect(result).toEqual({ written: 0, skipped: [], blocked: 'collection-missing' })
      expect(detail).toEqual({ detailKey: 'collectionMissing' })
      expect(repointTracks).not.toHaveBeenCalled()
    })

    it('stays quiet when there was nothing to repoint', async () => {
      const track = vi.fn()
      const result = await flushLibraryRepoints(
        {
          collectionPath: '',
          collectionMissing: true,
          endBatch: () => [],
          repointTracks: async () => [],
          track,
        },
        KEYS,
      )
      expect(result).toEqual({ written: 0, skipped: [] })
      expect(track).not.toHaveBeenCalled()
    })
  })
})
