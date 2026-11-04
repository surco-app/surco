import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import type { LibraryTagUpdate } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { createRekordboxQueue, type QueueStore } from './rekordboxQueue'
import type { TrackOp } from './rekordboxQueueOps'
import { applySeratoBatch } from './seratoBatch'
import { crateFileOf, crateTrackPaths } from './seratoCrateFile'
import { parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { twoRoots } from './seratoLibraryFixture'
import { seratoTagOps, syncSeratoTags } from './seratoTagSync'

const PRAY = '/Users/vicent/Music/Serato Pruebas/Pray.aiff'
const PRAY_PFIL = 'Users/vicent/Music/Serato Pruebas/Pray.aiff'
const VRSN = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
const dbOf = (root: SeratoLibraryRoot): string => join(root.dir, 'database V2')

const UPDATES: LibraryTagUpdate[] = [
  { path: PRAY, fields: { title: { from: 'Pray (old)', to: 'Pray' } } },
]

const memoryStore = (): QueueStore => {
  let text: string | null = null
  return {
    read: () => text,
    write: (t) => {
      text = t
    },
    setAside: () => {},
  }
}

function prayInSerato() {
  const { roots, deps } = twoRoots({ internal: ['A'] })
  writeFileSync(
    dbOf(roots[0]),
    concat([VRSN, track({ ttyp: 'aiff', pfil: PRAY_PFIL, tsng: 'Pray (old)', tart: 'Tina' })]),
  )
  return { roots, deps }
}

function depsWith({ running }: { running: boolean }) {
  const { roots, deps } = prayInSerato()
  const queue = createRekordboxQueue({
    store: memoryStore(),
    collection: () => roots[0].dir,
    applyBatch: (_l, ops, ensureClosed, stillQueued) =>
      applySeratoBatch(ops, { ...deps, ensureClosed, stillQueued }),
    repoint: async () => [],
    nodeStamps: async () => ({}),
    onChange: () => {},
    addsTracks: false,
  })
  return {
    roots,
    queue,
    sync: {
      enabled: true,
      roots: () => roots,
      queue,
      isRunning: async () => running,
      onWaiting: vi.fn(),
      onApplied: vi.fn(),
    },
  }
}

const titleOfPray = (roots: SeratoLibraryRoot[]) =>
  parseSeratoDatabase(readFileSync(dbOf(roots[0])))[0].title

describe('seratoTagOps', () => {
  it('takes title, artist, album and genre with the value the review chose', () => {
    const { roots } = prayInSerato()
    expect(
      seratoTagOps(
        [
          {
            path: PRAY,
            fields: {
              title: { from: 'a', to: 'Pray' },
              artist: { from: 'a', to: 'Tina' },
              album: { from: 'a', to: 'P' },
              genre: { from: 'a', to: 'House' },
              albumArtist: { from: 'a', to: 'b' },
            },
          },
        ],
        roots,
      ),
    ).toEqual([
      {
        id: expect.any(String),
        kind: 'tags',
        path: PRAY,
        label: 'Pray.aiff',
        fields: { tsng: 'Pray', tart: 'Tina', talb: 'P', tgen: 'House' },
        from: { tsng: 'a', tart: 'a', talb: 'a', tgen: 'a' },
      },
    ])
  })

  it('never syncs albumArtist and skips tracks Serato does not have', () => {
    const { roots } = prayInSerato()
    expect(
      seratoTagOps(
        [
          { path: PRAY, fields: { albumArtist: { from: 'a', to: 'b' } } },
          { path: '/Users/dj/x.mp3', fields: { title: { from: 'a', to: 'b' } } },
        ],
        roots,
      ),
    ).toEqual([])
  })

  it('skips a track on a drive no Serato library covers', () => {
    const { roots } = prayInSerato()
    expect(seratoTagOps(UPDATES, [roots[1]])).toEqual([])
  })
})

describe('syncSeratoTags', () => {
  it('writes at once with Serato closed and reports the count', async () => {
    const { roots, sync } = depsWith({ running: false })
    expect(await syncSeratoTags(UPDATES, sync)).toEqual({ outcome: 'updated', count: 1 })
    expect(titleOfPray(roots)).toBe('Pray')
  })

  it('queues with Serato open and says it will save on close', async () => {
    const { roots, queue, sync } = depsWith({ running: true })
    expect(await syncSeratoTags(UPDATES, sync)).toEqual({ outcome: 'queued' })
    expect(sync.onWaiting).toHaveBeenCalled()
    expect(titleOfPray(roots)).toBe('Pray (old)')
    expect(queue.state().items).toEqual([
      { key: `track:${PRAY}`, label: 'Pray.aiff', parts: [{ kind: 'tags' }] },
    ])
  })

  it('writes what was queued once Serato is closed', async () => {
    const { roots, queue, sync } = depsWith({ running: true })
    await syncSeratoTags(UPDATES, sync)
    expect(await queue.apply(async () => true)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(titleOfPray(roots)).toBe('Pray')
  })

  it('leaves Serato as the user left it when Undo comes after they changed the title in Serato', async () => {
    const { roots, sync } = depsWith({ running: false })
    await syncSeratoTags(UPDATES, sync)
    writeFileSync(
      dbOf(roots[0]),
      concat([VRSN, track({ ttyp: 'aiff', pfil: PRAY_PFIL, tsng: 'Pray (mine)', tart: 'Tina' })]),
    )
    const undo: LibraryTagUpdate[] = [
      { path: PRAY, fields: { title: { from: 'Pray', to: 'Pray (old)' } } },
    ]
    expect(await syncSeratoTags(undo, sync)).toEqual({ outcome: 'nothing' })
    expect(titleOfPray(roots)).toBe('Pray (mine)')
  })

  it('announces what else in the Serato queue it wrote, and keeps its own tags for the review', async () => {
    const { sync } = depsWith({ running: false })
    const other = { id: 'other', applied: true, notices: [] }
    const queue = {
      enqueue: vi.fn(),
      apply: vi.fn(async () => ({
        status: 'applied' as const,
        tracks: 2,
        changes: 1,
        notices: [],
        written: [],
        outcomes: [{ id: queue.enqueue.mock.calls[0][0][0].id, applied: true, notices: [] }, other],
      })),
      drop: vi.fn(),
      queuedOps: () => [],
    }
    expect(await syncSeratoTags(UPDATES, { ...sync, queue })).toEqual({
      outcome: 'updated',
      count: 1,
    })
    expect(sync.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applied', changes: 1, outcomes: [other] }),
    )
  })

  it('announces crate picks queued for the same track it wrote, so the editor clears them', async () => {
    const { roots, queue, sync } = depsWith({ running: false })
    const wanted = [{ id: 'A', name: 'A' }]
    const picks: TrackOp = {
      id: 'picks',
      kind: 'track',
      path: PRAY,
      label: 'Pray.aiff',
      facts: null,
      wanted,
      known: [],
      stamps: {},
    }
    queue.enqueue([picks])
    expect(await syncSeratoTags(UPDATES, sync)).toEqual({ outcome: 'updated', count: 1 })
    expect(sync.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: 1, written: [{ path: PRAY, wanted }] }),
    )
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'A')))).toContain(PRAY_PFIL)
  })

  it('announces nothing when only its own tags were written', async () => {
    const { sync } = depsWith({ running: false })
    await syncSeratoTags(UPDATES, sync)
    expect(sync.onApplied).not.toHaveBeenCalled()
  })

  it('takes its changes back out of the queue when the write throws, so the sheet saying failed stays true', async () => {
    const { sync } = depsWith({ running: false })
    const queue = {
      enqueue: vi.fn(),
      apply: vi.fn(async () => {
        throw new Error('boom')
      }),
      drop: vi.fn(),
      queuedOps: () => [],
    }
    await expect(syncSeratoTags(UPDATES, { ...sync, queue })).rejects.toThrow('boom')
    expect(queue.drop).toHaveBeenCalledWith(queue.enqueue.mock.calls[0][0][0].id)
  })

  it('runs inside the shared library flush without waiting on it', async () => {
    const { sync } = depsWith({ running: false })
    expect(await serialLibraryFlush(() => syncSeratoTags(UPDATES, sync))).toEqual({
      outcome: 'updated',
      count: 1,
    })
  })

  it('takes its changes back out of the queue when the write is refused', async () => {
    const { sync } = depsWith({ running: false })
    const queue = {
      enqueue: vi.fn(),
      apply: vi.fn(async () => ({ status: 'refused' as const, reason: 'backup-failed' as const })),
      drop: vi.fn(),
      queuedOps: () => [],
    }
    expect(await syncSeratoTags(UPDATES, { ...sync, queue })).toEqual({ outcome: 'failed' })
    expect(queue.drop).toHaveBeenCalledWith(queue.enqueue.mock.calls[0][0][0].id)
  })

  it('does nothing when the Serato sync is off', async () => {
    const { roots, sync } = depsWith({ running: false })
    expect(await syncSeratoTags(UPDATES, { ...sync, enabled: false })).toEqual({
      outcome: 'nothing',
    })
    expect(titleOfPray(roots)).toBe('Pray (old)')
  })

  it('says the library is missing when there is no Serato library', async () => {
    const { sync } = depsWith({ running: false })
    expect(await syncSeratoTags(UPDATES, { ...sync, roots: () => [] })).toEqual({
      outcome: 'missing',
    })
  })

  it('says nothing changed when Serato has none of the tracks', async () => {
    const { sync } = depsWith({ running: false })
    expect(
      await syncSeratoTags(
        [{ path: '/Users/dj/x.mp3', fields: { title: { from: 'a', to: 'b' } } }],
        sync,
      ),
    ).toEqual({ outcome: 'nothing' })
  })
})
