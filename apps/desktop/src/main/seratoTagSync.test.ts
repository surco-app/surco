import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import type { LibraryTagUpdate } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { createRekordboxQueue, type QueueStore } from './rekordboxQueue'
import { applySeratoBatch } from './seratoBatch'
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
  const { roots, deps } = twoRoots({ internal: [] })
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
