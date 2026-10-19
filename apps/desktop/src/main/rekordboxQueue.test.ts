import { describe, expect, it, vi } from 'vitest'
import type { RekordboxQueueState } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { createRekordboxQueue, type QueueDeps, type QueueStore } from './rekordboxQueue'
import type { BatchResult, QueueOp, TrackOp } from './rekordboxQueueOps'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

function memoryStore(
  initial: string | null = null,
): QueueStore & { text: string | null; aside: boolean } {
  const store = {
    text: initial,
    aside: false,
    read: () => store.text,
    write: (text: string) => {
      store.text = text
    },
    setAside: () => {
      store.aside = true
      store.text = null
    },
  }
  return store
}

const track = (id: string, path: string, over: Partial<TrackOp> = {}): TrackOp => ({
  id,
  kind: 'track',
  path,
  label: path.split('/').pop() ?? path,
  facts: null,
  wanted: [{ id: '3000', name: 'Makina' }],
  known: [],
  stamps: {},
  ...over,
})

const rename: QueueOp = {
  id: 'e1',
  kind: 'edit',
  edit: { kind: 'rename', playlistId: '3000', name: 'Makina 26' },
  stamps: {},
  label: 'Makina',
}

const applied = (ops: QueueOp[]): BatchResult => ({
  ok: true,
  wrote: true,
  outcomes: ops.map((o) => ({ id: o.id, applied: true, notices: [] })),
})

function deps(over: Partial<QueueDeps> = {}) {
  const base = {
    store: memoryStore(),
    collection: () => '/c/master.db',
    applyBatch: vi.fn<QueueDeps['applyBatch']>(async (_c, ops) => applied(ops)),
    repoint: vi.fn<QueueDeps['repoint']>(async (_c, list) =>
      list.map((): LibraryRepointResult => ({ written: true })),
    ),
    nodeStamps: vi.fn<QueueDeps['nodeStamps']>(async () => ({})),
    onChange: vi.fn<(s: RekordboxQueueState) => void>(),
  }
  return Object.assign(base, over)
}

const closed = async () => true

describe('rekordbox queue', () => {
  it('survives a restart so what waits for rekordbox to close outlives Surco', () => {
    const d = deps()
    createRekordboxQueue(d).enqueue([track('a', '/m/a.wav')])
    const again = createRekordboxQueue({ ...d, onChange: vi.fn() })
    expect(again.state().tracks).toBe(1)
  })

  it('keeps only the latest operation for one track, since converting twice leaves one wish', () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([track('a', '/m/a.wav')])
    q.enqueue([track('b', '/m/a.wav', { wanted: [{ name: 'Cierre' }] })])
    expect(q.state().items).toEqual([
      {
        key: 'track:/m/a.wav',
        label: 'a.wav',
        parts: [{ kind: 'collection' }, { kind: 'playlists', names: ['Cierre'] }],
      },
    ])
  })

  it('counts tracks apart from tree changes, and names what happens to each', () => {
    const q = createRekordboxQueue(deps())
    const repoint: RekordboxRepoint = { from: '/m/b.mp3', to: '/m/b.wav' }
    q.enqueue([track('a', '/m/a.wav', { contentId: '101' }), rename], [repoint])
    expect(q.state()).toEqual({
      tracks: 2,
      changes: 1,
      items: [
        { key: 'track:/m/b.wav', label: 'b.wav', parts: [{ kind: 'repoint' }] },
        {
          key: 'track:/m/a.wav',
          label: 'a.wav',
          parts: [{ kind: 'playlists', names: ['Makina'] }],
        },
        { key: 'edit:e1', label: 'Makina', parts: [{ kind: 'tree', edit: 'rename' }] },
      ],
    })
  })

  it('tells the window every time the queue changes', () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    q.discard()
    expect(d.onChange).toHaveBeenCalledTimes(2)
    expect(d.onChange).toHaveBeenLastCalledWith({ tracks: 0, changes: 0, items: [] })
  })

  it('applies the repoints before the batch so a track converted to WAV is found under its new path', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    const calls: string[] = []
    d.repoint.mockImplementation(async (_c, list) => {
      calls.push('repoint')
      return list.map(() => ({ written: true }))
    })
    d.applyBatch.mockImplementation(async (_c, ops) => {
      calls.push('batch')
      return applied(ops)
    })
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(closed)).toEqual({
      status: 'applied',
      tracks: 1,
      changes: 0,
      notices: [],
      written: [{ path: '/m/b.wav', wanted: [{ id: '3000', name: 'Makina' }] }],
      outcomes: [{ id: 'a', applied: true, notices: [] }],
    })
    expect(calls).toEqual(['repoint', 'batch'])
    expect(q.isEmpty()).toBe(true)
  })

  it('drops an operation the batch refused for a conflict because rekordbox won, and says so', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: true,
        wrote: false,
        outcomes: [{ id: 'e1', applied: false, reason: 'stale', notices: [] }],
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    const result = await q.apply(closed)
    expect(result.status === 'applied' && result.notices).toEqual([
      { code: 'edit-changed', playlist: 'Makina' },
    ])
    expect(result.status === 'applied' && result.outcomes[0].notices).toEqual([
      { code: 'edit-changed', playlist: 'Makina' },
    ])
    expect(q.isEmpty()).toBe(true)
  })

  it('lists each track it wrote with the playlists it carried and leaves out the one rekordbox refused', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: true,
        wrote: true,
        outcomes: [
          { id: 'a', applied: true, notices: [] },
          { id: 'b', applied: false, reason: 'stale', notices: [] },
          { id: 'e1', applied: true, notices: [] },
        ],
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([
      track('a', '/m/a.wav', { wanted: [{ name: 'Surco prueba A' }] }),
      track('b', '/m/b.wav'),
      rename,
    ])
    const result = await q.apply(closed)
    expect(result.status === 'applied' && result.written).toEqual([
      { path: '/m/a.wav', wanted: [{ name: 'Surco prueba A' }] },
    ])
  })

  it('keeps everything when the batch is refused because nothing written means nothing lost', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: false,
        reason: 'backup-failed',
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'backup-failed' })
    expect(q.state().changes).toBe(1)
  })

  it('writes no batch when the repoints stop for the whole collection', async () => {
    const d = deps({
      repoint: vi.fn<QueueDeps['repoint']>(async () => [
        { written: false, reason: 'rekordbox-running' },
      ]),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'rekordbox-running' })
    expect(d.applyBatch).not.toHaveBeenCalled()
    expect(q.state().items[0].parts).toContainEqual({ kind: 'repoint' })
  })

  it('asks nothing and writes nothing when the user keeps rekordbox open', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(async () => false)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(d.repoint).not.toHaveBeenCalled()
  })

  it('keeps operations queued while an apply is running so a finishing conversion is not swept away', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/a.wav')])
    d.applyBatch.mockImplementationOnce(async (_c, ops) => {
      q.enqueue([track('b', '/m/b.wav')])
      return applied(ops)
    })
    await q.apply(closed)
    expect(q.state().items.map((i) => i.key)).toEqual(['track:/m/b.wav'])
  })

  it('never runs two applies at once', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    let inFlight = 0
    let most = 0
    d.applyBatch.mockImplementation(async (_c, ops) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return applied(ops)
    })
    q.enqueue([track('a', '/m/a.wav')])
    await Promise.all([q.apply(closed), q.apply(closed)])
    expect(most).toBe(1)
  })

  it('sets an unreadable file aside and starts empty', () => {
    const store = memoryStore('{ not json')
    const q = createRekordboxQueue(deps({ store }))
    expect(q.isEmpty()).toBe(true)
    expect(store.aside).toBe(true)
  })

  it('tells about a repoint the library found under more than one entry instead of dropping it', async () => {
    const d = deps({
      repoint: vi.fn<QueueDeps['repoint']>(async () => [{ written: false, reason: 'ambiguous' }]),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    const result = await q.apply(closed)
    expect(result.status === 'applied' && result.notices).toEqual([
      { code: 'ambiguous', track: 'b.wav' },
    ])
    expect(result.status === 'applied' && result.tracks).toBe(0)
  })

  it('moves a queued stamp along with a playlist Surco itself just wrote so it never reads as a rekordbox change', async () => {
    const store = memoryStore()
    const nodeStamps = vi
      .fn<NonNullable<QueueDeps['nodeStamps']>>()
      .mockResolvedValueOnce({ '3000': 100, '3001': 50 })
      .mockResolvedValueOnce({ '3000': 200, '3001': 50 })
    const d = deps({ store, nodeStamps })
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/a.wav')])
    d.applyBatch.mockImplementationOnce(async (_c, ops, ensureClosed) => {
      await ensureClosed()
      q.enqueue([
        track('b', '/m/b.wav', { stamps: { '3000': 100, '3001': 50 } }),
        track('c', '/m/c.wav', { stamps: { '3000': 90 } }),
      ])
      return applied(ops)
    })
    await q.apply(closed)
    const saved = JSON.parse(store.text ?? '{}') as { ops: TrackOp[] }
    expect(saved.ops.map((o) => o.stamps)).toEqual([{ '3000': 200, '3001': 50 }, { '3000': 90 }])
  })

  async function stampsAfterBatch(
    batch: (ops: QueueOp[]) => BatchResult,
    second: () => Promise<Record<string, number>>,
  ) {
    const store = memoryStore()
    const nodeStamps = vi
      .fn<QueueDeps['nodeStamps']>()
      .mockResolvedValueOnce({ '3000': 100 })
      .mockImplementationOnce(second)
    const d = deps({ store, nodeStamps })
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/a.wav')])
    d.applyBatch.mockImplementationOnce(async (_c, ops, ensureClosed) => {
      await ensureClosed()
      q.enqueue([track('b', '/m/b.wav', { stamps: { '3000': 100 } })])
      return batch(ops)
    })
    const result = await q.apply(closed)
    const saved = JSON.parse(store.text ?? '{}') as { ops: TrackOp[] }
    return { result, saved }
  }

  it('refreshes no stamp when the batch wrote nothing since no node moved', async () => {
    const { saved } = await stampsAfterBatch(
      (ops) => ({ ...applied(ops), wrote: false }),
      async () => ({ '3000': 200 }),
    )
    expect(saved.ops.map((o) => o.stamps)).toEqual([{ '3000': 100 }])
  })

  it('keeps the recorded stamp of a node the batch deleted so the op still reads as stale', async () => {
    const { saved } = await stampsAfterBatch(applied, async () => ({}))
    expect(saved.ops.map((o) => o.stamps)).toEqual([{ '3000': 100 }])
  })

  it('still reports a write whose stamp read failed afterwards and has already dropped the applied ops', async () => {
    const { result, saved } = await stampsAfterBatch(applied, async () => {
      throw new Error('xml gone')
    })
    expect(result).toMatchObject({ status: 'applied', tracks: 1 })
    expect(saved.ops.map((o) => o.id)).toEqual(['b'])
  })

  it('tells about a conversion output that is missing instead of dropping the repoint', async () => {
    const d = deps({
      repoint: vi.fn<QueueDeps['repoint']>(async () => [
        { written: false, reason: 'output-missing' },
      ]),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    const result = await q.apply(closed)
    expect(result.status === 'applied' && result.notices).toEqual([
      { code: 'file-missing', track: 'b.wav' },
    ])
  })
})
