// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRekordboxQueue } from './rekordboxQueue'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import type { NmlPatch } from './traktorNml'
import type { SyncResult } from './traktorNmlLibrary'
import {
  holdInQueue,
  nmlPatchOf,
  type QueuedNmlPatch,
  queuedNmlPatch,
  syncQueuedPatches,
} from './traktorPatchQueue'

const patch = (over: Partial<NmlPatch> = {}): NmlPatch => ({
  volume: 'Macintosh HD',
  dir: '/:Musica/:',
  file: 'uno.aiff',
  newFile: 'uno.flac',
  outputVolume: 'Macintosh HD',
  outputDir: '/:Musica/:',
  outputFile: 'uno.flac',
  ...over,
})

describe('queuedNmlPatch', () => {
  // The queue lives in a JSON file so a patch survives Traktor staying open past the
  // run, or Surco quitting. JSON turns a Uint8Array into an object of numbered keys, so
  // a cue tree stored raw came back as something readTraktorMarkers cannot read, and the
  // track's cues would be lost on the write the queue exists to make.
  it('keeps the cue tree byte for byte through the queue file', () => {
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])
    const stored = JSON.parse(JSON.stringify(queuedNmlPatch(patch({ cueTree: tree }))))

    expect(nmlPatchOf(stored)).toEqual(patch({ cueTree: tree }))
  })

  it('leaves a patch without cues without them', () => {
    const stored = JSON.parse(JSON.stringify(queuedNmlPatch(patch())))

    expect(nmlPatchOf(stored)).toEqual(patch())
  })

  // The queue keeps one entry per source, so converting the same track again while the
  // first patch still waits replaces it instead of writing both.
  it('names the source the entry is found by, whatever its Unicode form', () => {
    const nfd = queuedNmlPatch(patch({ file: 'Café.aiff'.normalize('NFD') }))
    const nfc = queuedNmlPatch(patch({ file: 'Café.aiff'.normalize('NFC') }))

    expect(nfd.from).toBe(nfc.from)
    expect(nfd.from).not.toBe(queuedNmlPatch(patch({ dir: '/:Otra/:' })).from)
    expect(nfd.to).toBe('uno.flac')
  })
})

describe('holdInQueue', () => {
  const state = (parts: { kind: 'repoint' | 'cues' }[]) => ({
    tracks: parts.length,
    changes: 0,
    items: parts.map((p, i) => ({ key: `track:${i}`, label: '', parts: [p] })),
  })

  // Held patches are written by the queue's next apply, which waits for Traktor to close
  // rather than asking again: the user has just said no to closing it.
  it('stores the patches in the queue and asks it to apply them when it can', () => {
    const queue = { enqueue: vi.fn(() => true), state: () => state([]), applyQuietly: vi.fn() }

    holdInQueue(queue).hold([patch()])

    expect(queue.enqueue).toHaveBeenCalledWith([], [queuedNmlPatch(patch())])
    expect(queue.applyQuietly).toHaveBeenCalledOnce()
  })

  // Saved cues waiting in the same queue are checked against the collection when they are
  // written and do not depend on a run's order; only a conversion's patch does.
  it('counts as waiting only while a conversion patch is in the queue', () => {
    const queue = (parts: { kind: 'repoint' | 'cues' }[]) => ({
      enqueue: vi.fn(() => true),
      state: () => state(parts),
      applyQuietly: vi.fn(),
    })

    expect(holdInQueue(queue([])).waiting()).toBe(false)
    expect(holdInQueue(queue([{ kind: 'cues' }])).waiting()).toBe(false)
    expect(holdInQueue(queue([{ kind: 'cues' }, { kind: 'repoint' }])).waiting()).toBe(true)
  })
})

describe('syncQueuedPatches', () => {
  it('writes every waiting patch in one sync', async () => {
    const sync = vi.fn(
      async (_path: string, _patches: NmlPatch[]): Promise<SyncResult> => ({
        written: true,
        matched: 2,
      }),
    )
    const queued = [patch(), patch({ file: 'dos.aiff' })].map(queuedNmlPatch)

    const results = await syncQueuedPatches('/c.nml', queued, sync)

    expect(sync).toHaveBeenCalledWith('/c.nml', [patch(), patch({ file: 'dos.aiff' })])
    expect(results).toEqual([{ written: true }, { written: true }])
  })

  // The queue refuses and keeps everything on the reasons that stop a whole collection,
  // and drops the patches that simply found no track, as the run's own sync does.
  it('reports a refusal the queue keeps the patches for, and a miss it drops them for', async () => {
    const queued = [queuedNmlPatch(patch())]
    const answer = (reason: SyncResult['reason']) => async () => ({
      written: false,
      matched: 0,
      reason,
    })

    expect(await syncQueuedPatches('/c.nml', queued, answer('traktor-running'))).toEqual([
      { written: false, reason: 'rekordbox-running' },
    ])
    for (const reason of ['backup-failed', 'unreadable', 'write-failed'] as const)
      expect(await syncQueuedPatches('/c.nml', queued, answer(reason))).toEqual([
        { written: false, reason },
      ])
    expect(await syncQueuedPatches('/c.nml', queued, answer('no-matches'))).toEqual([
      { written: false, reason: 'no-match' },
    ])
  })
})

describe('the Traktor queue holding a run', () => {
  // The whole path a held run takes: kept in the queue file while Traktor is open, read
  // back by a fresh Surco, and written in one sync once Traktor closes, a re-converted
  // track only once and with its latest patch.
  it('writes the held patches after a restart, the latest per track, in one sync', async () => {
    let text: string | null = null
    const store = {
      read: () => text,
      write: (t: string) => {
        text = t
      },
      setAside: () => {},
    }
    const sync = vi.fn(
      async (_path: string, _patches: NmlPatch[]): Promise<SyncResult> => ({
        written: true,
        matched: 2,
      }),
    )
    const make = () =>
      createRekordboxQueue<QueuedNmlPatch>({
        store,
        collection: () => '/c.nml',
        applyBatch: async () => ({ ok: true, wrote: false, outcomes: [] }),
        repoint: (nml, list) => syncQueuedPatches(nml, list, sync),
        nodeStamps: async () => ({}),
        onChange: () => {},
      })
    const tree = buildTraktorTree([traktorCue('Drop', 0, 1000, 1)])
    const held = holdInQueue({ ...make(), applyQuietly: () => {} })
    held.hold([patch({ newFile: 'uno.mp3' }), patch({ file: 'dos.aiff', outputFile: 'dos.flac' })])
    held.hold([patch({ cueTree: tree })])

    const result = await make().apply(async () => true)

    expect(result).toMatchObject({ status: 'applied', tracks: 2 })
    expect(sync).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledWith('/c.nml', [
      patch({ cueTree: tree }),
      patch({ file: 'dos.aiff', outputFile: 'dos.flac' }),
    ])
    expect(make().isEmpty()).toBe(true)
  })
})
