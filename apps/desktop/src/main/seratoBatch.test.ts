import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cues = vi.hoisted(() => vi.fn())
vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: cues }))

import { createRekordboxQueue, type QueueDeps, type QueueStore } from './rekordboxQueue'
import type { CuesOp, QueueOp } from './rekordboxQueueOps'
import { applySeratoBatch, applySeratoLibraryOps } from './seratoBatch'
import { crateFileOf } from './seratoCrateFile'
import type { applySeratoCuesBatch } from './seratoCuesWrite'
import { create, del, editOp, listCrates, tempsUnder, twoRoots } from './seratoLibraryFixture'

const cueWriter = vi.mocked(cues as unknown as typeof applySeratoCuesBatch)

const PHASE_B_CUES_OP: CuesOp = {
  id: 'c',
  kind: 'cues',
  contentId: 'serato:/Users/dj/Music/a.mp3',
  path: '/Users/dj/Music/a.mp3',
  label: 'a.mp3',
  fingerprint: '0:1000:1',
  wanted: [{ id: '0', kind: 1, ms: 1000, color: 1 }],
}

const PHASE_B_FILE = JSON.stringify({
  version: 2,
  queues: [{ repoints: [], ops: [PHASE_B_CUES_OP], collection: '/Users/dj/Music/_Serato_' }],
})

const memoryStore = (text: string | null): QueueStore => ({
  read: () => text,
  write: () => {},
  setAside: () => {},
})

function depsWith() {
  const { roots, deps } = twoRoots({ internal: ['A'] })
  return { roots, deps: { ...deps, ensureClosed: async () => true } }
}

beforeEach(() => {
  cueWriter.mockReset()
  cueWriter.mockResolvedValue({
    ok: true,
    wrote: true,
    outcomes: [{ id: 'c', applied: true, notices: [] }],
  })
})

describe('applySeratoLibraryOps', () => {
  it('writes nothing and leaves no temp when Serato opens before the rename', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
    const open = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    expect(
      await applySeratoLibraryOps([editOp(del('A'))], {
        ...deps,
        seratoOpen: open,
        ensureClosed: async () => true,
      }),
    ).toEqual({ ok: false, reason: 'cancelled' })
    expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
    expect(tempsUnder(roots[0].dir)).toEqual([])
  })

  it('does not touch the library while Serato is still open', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    expect(
      await applySeratoLibraryOps([editOp(del('A'))], { ...deps, ensureClosed: async () => false }),
    ).toEqual({ ok: false, reason: 'cancelled' })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })

  it('deletes Techno and creates Techno again in one batch, in the order the user did it', async () => {
    const { roots, deps } = twoRoots({ internal: ['Techno'] })
    const ops = [editOp(del('Techno')), editOp(create('root', 'Techno'))]
    const result = await applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true }, { applied: true, createdId: 'Techno' }],
    })
    expect(listCrates(roots[0])).toEqual(['Techno.crate'])
  })

  it('renames A to X and creates a new A in one batch', async () => {
    const { roots, deps, bytes: before } = twoRoots({ internal: ['A'] })
    const ops = [
      editOp({ kind: 'rename', playlistId: 'A', name: 'X' }),
      editOp(create('root', 'A')),
    ]
    const result = await applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }, { applied: true }] })
    expect(listCrates(roots[0])).toEqual(['A.crate', 'X.crate'])
    expect(readFileSync(crateFileOf(roots[0], 'X'))).toEqual(before.internal.A)
  })

  it('skips an op undone while the batch waited', async () => {
    const { roots, deps } = depsWith()
    const op = editOp(del('A'))
    expect(await applySeratoLibraryOps([op], { ...deps, stillQueued: () => false })).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: op.id, applied: false, reason: 'cancelled', notices: [] }],
    })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })

  it('says nothing was written when no op changed a file', async () => {
    const { deps } = depsWith()
    const result = await applySeratoLibraryOps([editOp(del('Gone'))], deps)
    expect(result).toMatchObject({ ok: true, wrote: false, outcomes: [{ applied: false }] })
  })
})

describe('applySeratoBatch', () => {
  it('keeps applying cue ops queued by phase (b) and routes them to the cue writer', async () => {
    const { deps } = depsWith()
    const result = await applySeratoBatch([PHASE_B_CUES_OP, editOp(create('root', 'N'))], deps)
    expect(cueWriter).toHaveBeenCalledWith([PHASE_B_CUES_OP], expect.anything())
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ id: 'c', applied: true }, { applied: true }],
    })
  })

  it('writes the cues before the library, so a library refusal only reruns cues that are already there', async () => {
    const { roots, deps } = depsWith()
    const result = await applySeratoBatch([editOp(del('A')), PHASE_B_CUES_OP], {
      ...deps,
      seratoOpen: async () => true,
    })
    expect(cueWriter).toHaveBeenCalledWith([PHASE_B_CUES_OP], expect.anything())
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })

  it('leaves the library untouched when the cue part could not be written', async () => {
    const { roots, deps } = depsWith()
    cueWriter.mockResolvedValue({ ok: false, reason: 'cancelled' })
    const result = await applySeratoBatch([PHASE_B_CUES_OP, editOp(del('A'))], deps)
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })

  it('hands a batch of cues alone to the cue writer as phase (b) did', async () => {
    const { deps } = depsWith()
    const ensureClosed = vi.fn(async () => true)
    await applySeratoBatch([PHASE_B_CUES_OP], { ...deps, ensureClosed })
    expect(cueWriter).toHaveBeenCalledWith(
      [PHASE_B_CUES_OP],
      expect.objectContaining({ ensureClosed }),
    )
    expect(ensureClosed).not.toHaveBeenCalled()
  })

  it('reads a serato-cue-queue.json written by phase (b) and applies it', async () => {
    const { deps } = depsWith()
    const SERATO_QUEUE_DEPS: QueueDeps = {
      store: memoryStore(null),
      collection: () => '/Users/dj/Music/_Serato_',
      applyBatch: (_l, ops: QueueOp[], ensureClosed, stillQueued) =>
        applySeratoBatch(ops, { ...deps, ensureClosed, stillQueued }),
      repoint: async () => [],
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    }
    const queue = createRekordboxQueue({ ...SERATO_QUEUE_DEPS, store: memoryStore(PHASE_B_FILE) })
    expect(queue.state().items).toHaveLength(1)
    expect(await queue.apply(async () => true)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(cueWriter).toHaveBeenCalledWith([PHASE_B_CUES_OP], expect.anything())
    expect(queue.isEmpty()).toBe(true)
  })
})
