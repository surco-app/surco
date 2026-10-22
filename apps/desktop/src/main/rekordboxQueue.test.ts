import log from 'electron-log/main'
import { describe, expect, it, vi } from 'vitest'
import type { RekordboxQueueState } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { createRekordboxQueue, type QueueDeps, type QueueStore } from './rekordboxQueue'
import type { BatchResult, CuesOp, QueueOp, TrackOp } from './rekordboxQueueOps'

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

  it('says it is writing while an apply runs and lets a quit wait for it to finish', async () => {
    let finish: (r: BatchResult) => void = () => {}
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(
        () => new Promise<BatchResult>((r) => (finish = r)),
      ),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    expect(q.busy()).toBe(false)
    const running = q.apply(closed)
    let idle = false
    const waiting = q.settled().then(() => {
      idle = true
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(q.busy()).toBe(true)
    expect(idle).toBe(false)
    finish(applied([rename]))
    await running
    await waiting
    expect(q.busy()).toBe(false)
  })

  it('holds every automatic apply after a write left the collection unknown, so the only good backup is never overwritten', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: false,
        reason: 'write-unknown',
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'write-unknown' })
    d.repoint.mockClear()
    d.applyBatch.mockClear()
    const again = createRekordboxQueue({ ...d, onChange: vi.fn() })
    expect(again.state().halted).toBe(true)
    expect(await again.apply(closed)).toEqual({ status: 'refused', reason: 'write-unknown' })
    expect(d.repoint).not.toHaveBeenCalled()
    expect(d.applyBatch).not.toHaveBeenCalled()
  })

  it('lets the user apply a held queue on purpose, and is no longer held once it writes', async () => {
    const d = deps()
    d.applyBatch.mockResolvedValueOnce({ ok: false, reason: 'write-unknown' })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    await q.apply(closed)
    expect(await q.apply(closed, { manual: true })).toMatchObject({ status: 'applied' })
    expect(q.state().halted).toBeUndefined()
  })

  it('is no longer held once the user discards', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: false,
        reason: 'write-unknown',
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    await q.apply(closed)
    q.discard()
    expect(q.state().halted).toBeUndefined()
  })

  it('never applies what was queued for one collection to another, and says the queue belongs elsewhere', async () => {
    let at = '/copy/master.db'
    const d = deps({ collection: () => at })
    const q = createRekordboxQueue(d)
    q.enqueue([rename], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    at = '/real/master.db'
    const again = createRekordboxQueue({ ...d, onChange: vi.fn() })
    expect(again.state().elsewhere).toBe(true)
    expect(await again.apply(closed)).toEqual({ status: 'refused', reason: 'other-collection' })
    expect(d.repoint).not.toHaveBeenCalled()
    expect(d.applyBatch).not.toHaveBeenCalled()
  })

  it('does not mix operations read from this collection into a queue held for another', () => {
    let at = '/copy/master.db'
    const q = createRekordboxQueue(deps({ collection: () => at }))
    q.enqueue([rename])
    at = '/real/master.db'
    q.enqueue([track('a', '/m/a.wav')])
    expect(q.state().items.map((i) => i.key)).toEqual(['edit:e1'])
  })

  it('tells the caller when it leaves operations out of a queue held for another collection, so a save is never taken as done', () => {
    let at = '/copy/master.db'
    const q = createRekordboxQueue(deps({ collection: () => at }))
    expect(q.enqueue([rename])).toBe(true)
    at = '/real/master.db'
    expect(q.enqueue([track('a', '/m/a.wav')])).toBe(false)
  })

  it('logs the run it leaves out of a queue held for another collection, so a lost repoint can be traced', () => {
    let at = '/copy/master.db'
    const q = createRekordboxQueue(deps({ collection: () => at }))
    q.enqueue([rename])
    at = '/real/master.db'
    vi.mocked(log.warn).mockClear()
    q.enqueue([track('a', '/m/a.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('1 repoint'))
  })

  it('does not call a queue held while no collection is found one for another collection', () => {
    let at = '/real/master.db'
    const q = createRekordboxQueue(deps({ collection: () => at }))
    q.enqueue([rename])
    at = ''
    expect(q.state().elsewhere).toBeUndefined()
  })

  it('belongs to the collection in use again once emptied', async () => {
    let at = '/copy/master.db'
    const d = deps({ collection: () => at })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    at = '/real/master.db'
    q.discard()
    q.enqueue([rename])
    expect(q.state().elsewhere).toBeUndefined()
    expect(await q.apply(closed)).toMatchObject({ status: 'applied' })
    expect(d.applyBatch).toHaveBeenCalledWith(
      '/real/master.db',
      [rename],
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('does not write what the user discarded while rekordbox was being closed, and reports nothing for it', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    d.applyBatch.mockImplementation(async (_c, ops, ensureClosed, stillQueued) => {
      await ensureClosed()
      return applied(ops.filter((o) => stillQueued(o.id)))
    })
    q.enqueue([rename])
    const result = await q.apply(async () => {
      q.discard()
      return true
    })
    expect(result).toEqual({
      status: 'applied',
      tracks: 0,
      changes: 0,
      notices: [],
      written: [],
      outcomes: [],
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

describe('cues in the queue', () => {
  const cues = (id: string, drops: number[], over: Partial<CuesOp> = {}): CuesOp => ({
    id,
    kind: 'cues',
    contentId: '103',
    path: '/m/a.wav',
    label: 'a',
    drops,
    previousDrops: [],
    fingerprint: 'f',
    ...over,
  })

  it('hands back the queued cues of a track so the editor can keep showing what will be written', () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([cues('c1', [1000]), cues('c2', [2000], { contentId: '104', path: '/m/b.wav' })])
    expect(q.cuesOp('103')?.drops).toEqual([1000])
    expect(q.cuesOp('999')).toBeUndefined()
  })

  it('forgets the queued cues of a track once they are dropped, since Undo takes the save back', () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([cues('c1', [1000])])
    q.drop('c1')
    expect(q.cuesOp('103')).toBeUndefined()
    expect(q.isEmpty()).toBe(true)
  })

  it('keeps the latest cues of a track and shows them on the track line, since saving twice leaves the last marking', () => {
    const store = memoryStore()
    const q = createRekordboxQueue(deps({ store }))
    q.enqueue([track('t', '/m/a.wav', { contentId: '103' }), cues('c1', [1000])])
    q.enqueue([cues('c2', [2000])])
    const saved = JSON.parse(store.text ?? '{}') as { ops: QueueOp[] }
    expect(saved.ops.filter((o) => o.kind === 'cues')).toEqual([cues('c2', [2000])])
    expect(q.state()).toEqual({
      tracks: 1,
      changes: 0,
      items: [
        {
          key: 'track:/m/a.wav',
          label: 'a.wav',
          parts: [{ kind: 'playlists', names: ['Makina'] }, { kind: 'cues' }],
        },
      ],
    })
  })

  it('counts the tracks a batch of cues alone wrote so "Listo en rekordbox" appears, and leaves them out of the written playlists', async () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([
      cues('c1', [1000]),
      cues('c2', [2000], { contentId: '104', path: '/m/b.wav', label: 'b' }),
    ])
    expect(await q.apply(closed)).toMatchObject({
      status: 'applied',
      tracks: 2,
      changes: 0,
      written: [],
    })
    expect(q.isEmpty()).toBe(true)
  })

  it('moves no stamp for queued cues after a batch wrote, since cues carry none', async () => {
    const store = memoryStore()
    const nodeStamps = vi
      .fn<QueueDeps['nodeStamps']>()
      .mockResolvedValueOnce({ '3000': 100 })
      .mockResolvedValueOnce({ '3000': 200 })
    const d = deps({ store, nodeStamps })
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/a.wav')])
    d.applyBatch.mockImplementationOnce(async (_c, ops, ensureClosed) => {
      await ensureClosed()
      q.enqueue([cues('c1', [1000]), track('b', '/m/b.wav', { stamps: { '3000': 100 } })])
      return applied(ops)
    })
    expect(await q.apply(closed)).toMatchObject({ status: 'applied', tracks: 1 })
    const saved = JSON.parse(store.text ?? '{}') as { ops: QueueOp[] }
    expect(saved.ops).toEqual([
      cues('c1', [1000]),
      track('b', '/m/b.wav', { stamps: { '3000': 200 } }),
    ])
  })

  it('never applies cues queued for one collection to another', async () => {
    let at = '/copy/master.db'
    const d = deps({ collection: () => at })
    const q = createRekordboxQueue(d)
    q.enqueue([cues('c1', [1000])])
    at = '/real/master.db'
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'other-collection' })
    expect(d.applyBatch).not.toHaveBeenCalled()
  })

  it('holds queued cues after a write left the collection unknown', async () => {
    const d = deps()
    d.applyBatch.mockResolvedValueOnce({ ok: false, reason: 'write-unknown' })
    const q = createRekordboxQueue(d)
    q.enqueue([cues('c1', [1000])])
    await q.apply(closed)
    d.applyBatch.mockClear()
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'write-unknown' })
    expect(d.applyBatch).not.toHaveBeenCalled()
  })
})
