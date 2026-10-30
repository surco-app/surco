// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('stores the patches in the queue and asks it to apply them when it can', async () => {
    const queue = { enqueue: vi.fn(() => true), state: () => state([]), applyQuietly: vi.fn() }

    await holdInQueue(queue, () => 'Macintosh HD').hold([patch()], '/c.nml')

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

    expect(holdInQueue(queue([]), () => 'Macintosh HD').waiting()).toBe(false)
    expect(holdInQueue(queue([{ kind: 'cues' }]), () => 'Macintosh HD').waiting()).toBe(false)
    expect(
      holdInQueue(queue([{ kind: 'cues' }, { kind: 'repoint' }]), () => 'Macintosh HD').waiting(),
    ).toBe(true)
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
    const queued = [patch(), patch({ file: 'dos.aiff' })].map((p) => queuedNmlPatch(p))

    const results = await syncQueuedPatches('/c.nml', queued, sync, 'Macintosh HD')

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

    expect(
      await syncQueuedPatches('/c.nml', queued, answer('traktor-running'), 'Macintosh HD'),
    ).toEqual([{ written: false, reason: 'rekordbox-running' }])
    for (const reason of ['backup-failed', 'unreadable', 'write-failed'] as const)
      expect(await syncQueuedPatches('/c.nml', queued, answer(reason), 'Macintosh HD')).toEqual([
        { written: false, reason },
      ])
    expect(await syncQueuedPatches('/c.nml', queued, answer('no-matches'), 'Macintosh HD')).toEqual(
      [{ written: false, reason: 'no-match' }],
    )
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
        repoint: (nml, list) => syncQueuedPatches(nml, list, sync, 'Macintosh HD'),
        nodeStamps: async () => ({}),
        onChange: () => {},
      })
    const tree = buildTraktorTree([traktorCue('Drop', 0, 1000, 1)])
    const held = holdInQueue({ ...make(), applyQuietly: () => {} }, () => 'Macintosh HD')
    await held.hold(
      [patch({ newFile: 'uno.mp3' }), patch({ file: 'dos.aiff', outputFile: 'dos.flac' })],
      '/c.nml',
    )
    await held.hold([patch({ cueTree: tree })], '/c.nml')

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

// What the DJ does in Traktor while a patch waits must survive the patch: the stars and cues
// the entry had when the patch was held are noted, and if they changed by the time Traktor
// closes, the entry only moves to the converted file.
describe('a held patch and the DJ’s edits in Traktor', () => {
  const collection = (ranking: string) => {
    const path = join(mkdtempSync(join(tmpdir(), 'surco-tq-')), 'collection.nml')
    const write = (r: string) =>
      writeFileSync(
        path,
        '<NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="Uno">' +
          '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
          `<INFO RANKING="${r}"></INFO></ENTRY></COLLECTION></NML>`,
      )
    write(ranking)
    return { path, write }
  }
  const sync = () =>
    vi.fn(
      async (_path: string, _patches: NmlPatch[]): Promise<SyncResult> => ({
        written: true,
        matched: 1,
      }),
    )

  it('notes the entry as it is when the patch is held', async () => {
    const nml = collection('153')
    const queue = {
      enqueue: vi.fn(() => true),
      state: () => ({ tracks: 0, changes: 0, items: [] }),
      applyQuietly: vi.fn(),
    }

    await holdInQueue(queue, () => 'Macintosh HD').hold([patch({ ranking: 51 })], nml.path)

    const [[, held]] = queue.enqueue.mock.calls as unknown as [[unknown, QueuedNmlPatch[]]]
    expect(held[0].entryState).toEqual(expect.any(String))
  })

  it('writes the whole patch while the entry is unchanged', async () => {
    const nml = collection('153')
    const queue = {
      enqueue: vi.fn(() => true),
      state: () => ({ tracks: 0, changes: 0, items: [] }),
      applyQuietly: vi.fn(),
    }
    await holdInQueue(queue, () => 'Macintosh HD').hold([patch({ ranking: 51 })], nml.path)
    const [[, held]] = queue.enqueue.mock.calls as unknown as [[unknown, QueuedNmlPatch[]]]
    const write = sync()

    await syncQueuedPatches(nml.path, held, write, 'Macintosh HD')

    expect(write.mock.calls[0][1]).toEqual([patch({ ranking: 51 })])
  })

  it('leaves the stars the DJ set after the patch was held', async () => {
    const nml = collection('153')
    const queue = {
      enqueue: vi.fn(() => true),
      state: () => ({ tracks: 0, changes: 0, items: [] }),
      applyQuietly: vi.fn(),
    }
    await holdInQueue(queue, () => 'Macintosh HD').hold([patch({ ranking: 51 })], nml.path)
    const [[, held]] = queue.enqueue.mock.calls as unknown as [[unknown, QueuedNmlPatch[]]]
    nml.write('255')
    const write = sync()

    await syncQueuedPatches(nml.path, held, write, 'Macintosh HD')

    expect(write.mock.calls[0][1]).toEqual([patch()])
  })

  // A boot-disk path leaves the volume empty and Traktor names the disk. Matched without it,
  // the entry was never noted, so a patch held while Traktor was open went in whole over the
  // cue the DJ moved, and shifted the cues a second time.
  it('leaves a cue the DJ moved on a boot-disk track while the patch waited', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'surco-tq-')), 'collection.nml')
    const write = (start: string) =>
      writeFileSync(
        path,
        '<NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="Uno">' +
          '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
          `<CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="${start}" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>` +
          '</ENTRY></COLLECTION></NML>',
      )
    write('10000.000000')
    const queue = {
      enqueue: vi.fn(() => true),
      state: () => ({ tracks: 0, changes: 0, items: [] }),
      applyQuietly: vi.fn(),
    }
    const onBoot = patch({ volume: '', outputVolume: '', cueShift: { shiftMs: 51 } })
    await holdInQueue(queue, () => 'Macintosh HD').hold([onBoot], path)
    const [[, held]] = queue.enqueue.mock.calls as unknown as [[unknown, QueuedNmlPatch[]]]
    write('12000.000000')
    const sync = vi.fn(
      async (_path: string, _patches: NmlPatch[]): Promise<SyncResult> => ({
        written: true,
        matched: 1,
      }),
    )

    await syncQueuedPatches(path, held, sync, 'Macintosh HD')

    expect(sync.mock.calls[0][1]).toEqual([patch({ volume: '', outputVolume: '' })])
  })

  // Patches held for one collection cannot be written to another, and wait in that
  // collection's own queue. Counted as waiting, they held every run made in this one behind
  // them.
  it('does not hold a run behind patches waiting for another collection', () => {
    const queue = {
      enqueue: vi.fn(() => true),
      applyQuietly: vi.fn(),
      state: () => ({ tracks: 0, changes: 0, elsewhere: 1, items: [] }),
    }
    expect(holdInQueue(queue, () => 'Macintosh HD').waiting()).toBe(false)
  })

  it('holds a run behind patches waiting for this collection while another collection waits too', () => {
    const queue = {
      enqueue: vi.fn(() => true),
      applyQuietly: vi.fn(),
      state: () => ({
        tracks: 1,
        changes: 0,
        elsewhere: 1,
        items: [{ key: 'track:0', label: '', parts: [{ kind: 'repoint' as const }] }],
      }),
    }
    expect(holdInQueue(queue, () => 'Macintosh HD').waiting()).toBe(true)
  })
})
