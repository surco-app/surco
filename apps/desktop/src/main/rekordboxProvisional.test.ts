import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TrackCueRow } from '../shared/types'
import { anlzFile, pqtzSection } from './anlzFixture'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  adjustmentOps,
  adjustProvisional,
  createProvisionalList,
  onRekordboxGrid,
  type ProvisionalEntry,
} from './rekordboxProvisional'
import type { QueueStore, RekordboxQueue } from './rekordboxQueue'

const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)
const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'

const row = (id: string, ms: number, kind: number, color: number | null = null): TrackCueRow => ({
  id,
  ms,
  kind,
  color,
})

describe('onRekordboxGrid', () => {
  it('moves each cue onto the nearest rekordbox beat, keeping its id so rekordbox updates it in place', () => {
    const out = onRekordboxGrid([row('a', 64_012, 0), row('b', 32_000 - 7, 1, 42)], BEATS)
    expect(out.wanted).toEqual([
      { id: 'a', ms: 64_000, kind: 0, color: null },
      { id: 'b', ms: 32_000, kind: 1, color: 42 },
    ])
    expect(out.moved).toBe(2)
    expect(out.maxMs).toBe(12)
  })

  it("leaves a cue more than a quarter beat from rekordbox's grid where it is, since Surco cannot tell which beat it meant", () => {
    const out = onRekordboxGrid([row('a', 64_250, 0), row('b', 32_003, 1, 42)], BEATS)
    expect(out.wanted[0]).toEqual({ id: 'a', ms: 64_250, kind: 0, color: null })
    expect(out.unfit).toBe(1)
    expect(out.moved).toBe(1)
  })

  it('never moves a loop, which Surco does not edit', () => {
    const loop = { ...row('l', 64_010, 0), loop: true }
    const out = onRekordboxGrid([loop], BEATS)
    expect(out.wanted).toEqual([{ id: 'l', ms: 64_010, kind: 0, color: null }])
    expect(out.moved).toBe(0)
  })

  it('counts a cue already on the beat as in place', () => {
    expect(onRekordboxGrid([row('a', 64_000, 0)], BEATS).moved).toBe(0)
  })
})

const entry = (over: Partial<ProvisionalEntry> = {}): ProvisionalEntry => ({
  contentId: '103',
  label: 'Gowan',
  wanted: [
    { ms: 64_012, kind: 0, color: null },
    { ms: 32_012, kind: 1, color: 42 },
  ],
  ...over,
})

async function collection(analysed: boolean, cues = entry().wanted): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-provisional-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '103' && analysed ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
    cueRows: cues.map((c, i) => ({
      ID: `q${i}`,
      ContentID: '103',
      InMsec: c.ms,
      Kind: c.kind,
      ColorTableIndex: c.color,
    })),
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
  return path
}

function opsFor(path: string, entries: ProvisionalEntry[]) {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return adjustmentOps(db, join(path, '..', 'share'), entries, () => 'op')
  } finally {
    db.close()
  }
}

describe('adjustmentOps', () => {
  it("queues the cues moved onto rekordbox's grid once rekordbox has analysed the track, and says how far they moved", async () => {
    const path = await collection(true)
    const { ops, settled } = opsFor(path, [entry()])
    expect(settled).toEqual(['103'])
    expect(ops).toHaveLength(1)
    expect(ops[0].wanted?.map((c) => c.ms).sort((a, b) => a - b)).toEqual([32_000, 64_000])
    expect(ops[0].notices).toEqual([{ code: 'cues-adjusted', track: 'Gowan', moved: 2, maxMs: 12 }])
  })

  it('waits for a track rekordbox has not analysed yet', async () => {
    const path = await collection(false)
    expect(opsFor(path, [entry()])).toEqual({ ops: [], settled: [] })
  })

  it('lets rekordbox win when the cues were changed there, and stops watching the track', async () => {
    const path = await collection(true, [{ ms: 70_010, kind: 0, color: null }])
    expect(opsFor(path, [entry()])).toEqual({ ops: [], settled: ['103'] })
  })

  it('stops watching a track the collection no longer holds', async () => {
    const path = await collection(true)
    expect(opsFor(path, [entry({ contentId: '999' })])).toEqual({ ops: [], settled: ['999'] })
  })

  it('says which cues it left alone even when nothing else needed moving', async () => {
    const far = [{ ms: 64_250, kind: 0, color: null }]
    const path = await collection(true, far)
    const { ops } = opsFor(path, [entry({ wanted: far })])
    expect(ops[0].notices).toEqual([{ code: 'cues-unfit', track: 'Gowan', count: 1 }])
  })

  it("settles a track whose cues already sit on rekordbox's beats without queuing anything", async () => {
    const exact = [{ ms: 64_000, kind: 0, color: null }]
    const path = await collection(true, exact)
    expect(opsFor(path, [entry({ wanted: exact })])).toEqual({ ops: [], settled: ['103'] })
  })
})

function memoryStore(): QueueStore & { text: string | null } {
  const store = {
    text: null as string | null,
    read: () => store.text,
    write: (t: string) => {
      store.text = t
    },
    setAside: () => {
      store.text = null
    },
  }
  return store
}

describe('createProvisionalList', () => {
  it('keeps the tracks waiting across a restart of Surco', () => {
    const store = memoryStore()
    createProvisionalList(store).add(entry())
    expect(createProvisionalList(store).all()).toEqual([entry()])
  })

  it('keeps one entry per track, the last set saved', () => {
    const list = createProvisionalList(memoryStore())
    list.add(entry())
    list.add(entry({ wanted: [] }))
    expect(list.all()).toEqual([entry({ wanted: [] })])
  })

  it('forgets the tracks it settled', () => {
    const list = createProvisionalList(memoryStore())
    list.add(entry())
    list.add(entry({ contentId: '104' }))
    list.settle(['103'])
    expect(list.all().map((e) => e.contentId)).toEqual(['104'])
  })

  it('says when a track starts waiting, so a Surco left open watches for rekordbox closing instead of waiting for a restart', () => {
    const waiting = vi.fn()
    const list = createProvisionalList(memoryStore(), waiting)
    list.add(entry())
    expect(waiting).toHaveBeenCalledTimes(1)
  })

  it('starts empty from a file it cannot read, instead of refusing to start', () => {
    const store = memoryStore()
    store.text = '{not json'
    expect(createProvisionalList(store).all()).toEqual([])
  })
})

describe('adjustProvisional', () => {
  const queueOf = (over: Partial<Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'state'>> = {}) => ({
    enqueue: vi.fn<RekordboxQueue['enqueue']>(() => true),
    cuesOp: vi.fn<RekordboxQueue['cuesOp']>(() => undefined),
    state: vi.fn<RekordboxQueue['state']>(() => ({ tracks: 0, changes: 0, items: [] })),
    ...over,
  })

  it('queues the adjustment of every analysed track and stops watching it', async () => {
    const path = await collection(true)
    const list = createProvisionalList(memoryStore())
    list.add(entry())
    const queue = queueOf()
    adjustProvisional({ list, collection: () => path, queue, newId: () => 'op' })
    expect(queue.enqueue).toHaveBeenCalledWith([expect.objectContaining({ contentId: '103' })])
    expect(list.all()).toEqual([])
  })

  it('leaves a track alone while its own save still waits in the queue, which would look like a change made in rekordbox', async () => {
    const path = await collection(true)
    const list = createProvisionalList(memoryStore())
    list.add(entry())
    const queue = queueOf({ cuesOp: vi.fn(() => ({}) as ReturnType<RekordboxQueue['cuesOp']>) })
    adjustProvisional({ list, collection: () => path, queue, newId: () => 'op' })
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(list.all()).toEqual([entry()])
  })

  it('touches nothing while the queue is halted', async () => {
    const path = await collection(true)
    const list = createProvisionalList(memoryStore())
    list.add(entry())
    const queue = queueOf({
      state: vi.fn(() => ({ tracks: 0, changes: 0, items: [], halted: true as const })),
    })
    adjustProvisional({ list, collection: () => path, queue, newId: () => 'op' })
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(list.all()).toEqual([entry()])
  })
})
