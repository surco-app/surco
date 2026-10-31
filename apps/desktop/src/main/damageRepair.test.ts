import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { isPackaged: false } }))
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { DamageRepair, TrashEntry } from '../shared/types'
import { pendingDamage } from './damageIpc'
import { type DamageRepairDeps, repairDamage } from './damageRepair'
import type { EngineRepoint } from './engineRepoint'
import type { LibraryRepointResult } from './libraryRepointFlush'
import { createSessionBackup } from './rekordboxSessionBackup'
import type { NmlPatch } from './traktorNml'
import { syncCollection } from './traktorNmlLibrary'

const MP3 = '/m/uno.mp3'
const WAV = '/m/dos.wav'
const BOOT = 'Macintosh HD'
const ENTRY = { volume: BOOT, dir: '/:m/:', file: 'uno.mp3', entryState: 'S' }

const genre: DamageRepair = {
  target: 'genre',
  path: MP3,
  from: '(35) Deep House',
  to: 'House; Deep House',
}
const traktor: DamageRepair = { target: 'traktor', path: MP3, addMs: 51.18, entry: ENTRY }
const engine: DamageRepair = {
  target: 'engine',
  path: WAV,
  fileBytes: 1234,
  expectTrackData: { sampleRate: 48000, sampleCount: 14400000 },
  trimmedMs: 0,
  sampleRateHz: 44100,
}
const item = (id: string, repair: DamageRepair) => ({ id, repair })

function deps(over: Partial<DamageRepairDeps> = {}): DamageRepairDeps {
  return {
    beginMoment: vi.fn(),
    genre: {
      allowed: () => true,
      exists: async () => true,
      rewrite: vi.fn(async () => ({
        outcomes: ['written' as const],
        backup: { id: 'b1' } as TrashEntry,
      })),
    },
    ...over,
  }
}

function traktorDeps(
  sync: (patches: NmlPatch[]) => Promise<{ written: boolean; matched: number; reason?: never }>,
) {
  return {
    traktorNmlPath: '/t/collection.nml',
    bootVolume: BOOT,
    readCollection: async () => null,
    ensureTraktorClosed: async () => true,
    showBlockedDialog: vi.fn(),
    syncCollection: vi.fn(async (_p: string, patches: NmlPatch[]) => sync(patches)),
    track: (async (_k: unknown, _l: unknown, run: () => Promise<unknown>) => run()) as never,
  }
}

function engineDeps(results: LibraryRepointResult[]) {
  return {
    collectionPath: '/e/Engine Library',
    countSamples: vi.fn(async () => 13230000),
    repointTracks: vi.fn(async (_dir: string, _list: EngineRepoint[]) => results),
    enqueue: vi.fn(),
  }
}

beforeEach(() => pendingDamage.clear())

describe('repairDamage — genres', () => {
  it('reports a written genre as repaired with its backup', async () => {
    const d = deps()
    expect(await repairDamage([item('g', genre)], d)).toEqual([
      { id: 'g', state: 'repaired', backupId: 'b1' },
    ])
    expect(d.genre.rewrite).toHaveBeenCalledWith(MP3, [
      { field: 'genre', from: '(35) Deep House', to: 'House; Deep House' },
    ])
  })

  it('reports a genre the guard refused as unchanged', async () => {
    const d = deps({
      genre: {
        allowed: () => true,
        exists: async () => true,
        rewrite: async () => ({ outcomes: ['unchanged'] }),
      },
    })
    expect(await repairDamage([item('g', genre)], d)).toEqual([{ id: 'g', state: 'unchanged' }])
  })

  it('reports a write that threw as failed with its message', async () => {
    const d = deps({
      genre: {
        allowed: () => true,
        exists: async () => true,
        rewrite: async () => Promise.reject(new Error('no-backup')),
      },
    })
    expect(await repairDamage([item('g', genre)], d)).toEqual([
      { id: 'g', state: 'failed', error: 'no-backup' },
    ])
  })
})

describe('repairDamage — Traktor', () => {
  // Sign check: the entry's cues are 51.18 ms early, so they move later, which is a negative
  // shiftMs for shiftCueStart (it subtracts).
  it('hands the collection a cue shift opposite to the ms to add', async () => {
    const t = traktorDeps(async () => ({ written: true, matched: 1 }))
    const out = await repairDamage([item('t', traktor)], deps({ traktor: t }))
    expect(t.syncCollection.mock.calls[0][1]).toEqual([
      { volume: BOOT, dir: '/:m/:', file: 'uno.mp3', cueShift: { shiftMs: -51.18 } },
    ])
    expect(out).toEqual([{ id: 't', state: 'repaired' }])
  })

  it('leaves the repair pending while Traktor stays open', async () => {
    const t = {
      ...traktorDeps(async () => ({ written: true, matched: 1 })),
      ensureTraktorClosed: async () => false,
    }
    const hold = vi.fn(async () => {})
    const out = await repairDamage([item('t', traktor)], deps({ traktor: { ...t, hold } }))
    expect(out).toEqual([{ id: 't', state: 'pending' }])
    expect(pendingDamage.has('t')).toBe(true)
    expect(hold).toHaveBeenCalledWith(expect.any(Array), ['S'], '/t/collection.nml')
  })
})

describe("repairDamage — a converted file's own Traktor tree", () => {
  const tree: DamageRepair = {
    target: 'traktor',
    path: WAV,
    addMs: -51.18,
    treeFile: WAV,
    treeMs: [10000],
  }

  it('moves the tree the scan read and reports its backup', async () => {
    const rewriteTree = vi.fn(async () => ({ written: true, backup: { id: 'b2' } as TrashEntry }))
    const out = await repairDamage([item('w', tree)], deps({ rewriteTree }))
    expect(rewriteTree).toHaveBeenCalledWith(WAV, -51.18, [10000])
    expect(out).toEqual([{ id: 'w', state: 'repaired', backupId: 'b2' }])
  })

  it('reports a tree that moved since the scan as unchanged', async () => {
    const rewriteTree = vi.fn(async () => ({ written: false }))
    expect(await repairDamage([item('w', tree)], deps({ rewriteTree }))).toEqual([
      { id: 'w', state: 'unchanged' },
    ])
  })

  it('moves the tree and the entry together, pending while Traktor is open', async () => {
    const rewriteTree = vi.fn(async () => ({ written: true, backup: { id: 'b2' } as TrashEntry }))
    const t = {
      ...traktorDeps(async () => ({ written: true, matched: 1 })),
      ensureTraktorClosed: async () => false,
      hold: vi.fn(async () => {}),
    }
    const out = await repairDamage(
      [item('w', { ...tree, entry: { ...ENTRY, file: 'dos.wav' } })],
      deps({ rewriteTree, traktor: t }),
    )
    expect(out).toEqual([{ id: 'w', state: 'pending', backupId: 'b2' }])
  })
})

describe('repairDamage — Engine DJ', () => {
  it('repairs the row in place, guarded by the trackData the scan read', async () => {
    const e = engineDeps([{ written: true }])
    const out = await repairDamage([item('e', engine)], deps({ engine: e }))
    expect(e.countSamples).toHaveBeenCalledWith(WAV)
    expect(e.repointTracks.mock.calls[0][1]).toEqual([
      {
        from: WAV,
        to: WAV,
        fromBytes: 1234,
        expectTrackData: { sampleRate: 48000, sampleCount: 14400000 },
        engineShift: { trimmedMs: 0, sampleRateHz: 44100, sampleCount: 13230000 },
        length: 300,
      },
    ])
    expect(out).toEqual([{ id: 'e', state: 'repaired' }])
  })

  it('queues the repair while Engine DJ is open', async () => {
    const e = engineDeps([{ written: false, reason: 'engine-running' }])
    const out = await repairDamage([item('e', engine)], deps({ engine: e }))
    expect(out).toEqual([{ id: 'e', state: 'pending' }])
    expect(e.enqueue).toHaveBeenCalledWith(e.repointTracks.mock.calls[0][1])
    expect(pendingDamage.has('e')).toBe(true)
  })

  it('reports a row that no longer holds the scanned trackData as unchanged', async () => {
    const e = engineDeps([{ written: false, reason: 'no-match' }])
    expect(await repairDamage([item('e', engine)], deps({ engine: e }))).toEqual([
      { id: 'e', state: 'unchanged' },
    ])
  })
})

describe('repairDamage — copies', () => {
  it('opens the review moment once, before the first write', async () => {
    const order: string[] = []
    const d = deps({
      beginMoment: vi.fn(() => order.push('moment')),
      genre: {
        allowed: () => true,
        exists: async () => true,
        rewrite: vi.fn(async () => {
          order.push('write')
          return { outcomes: ['written' as const] }
        }),
      },
    })
    await repairDamage([item('a', genre), item('b', { ...genre, path: '/m/b.mp3' })], d)
    expect(order).toEqual(['moment', 'write', 'write'])
  })

  it('opens no moment for nothing to repair', async () => {
    const d = deps()
    expect(await repairDamage([], d)).toEqual([])
    expect(d.beginMoment).not.toHaveBeenCalled()
  })
})

describe('repairDamage — on a real collection', () => {
  const cue = (start: number) =>
    `<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="${start.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>`
  it('puts the Intro back at 10 s and leaves the collection alone the second time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-damage-repair-'))
    const nmlPath = join(dir, 'collection.nml')
    writeFileSync(
      nmlPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?><NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="uno"><LOCATION DIR="/:m/:" FILE="uno.mp3" VOLUME="${BOOT}" VOLUMEID="x"></LOCATION><INFO></INFO>${cue(9948.82)}</ENTRY></COLLECTION></NML>`,
    )
    const { entryStates } = await import('./traktorNml')
    const state = entryStates(
      readFileSync(nmlPath, 'utf8'),
      [{ volume: BOOT, dir: '/:m/:', file: 'uno.mp3' }],
      BOOT,
    )[0] as string
    const session = createSessionBackup({})
    const real = {
      traktorNmlPath: nmlPath,
      bootVolume: BOOT,
      readCollection: async () => readFileSync(nmlPath, 'utf8'),
      ensureTraktorClosed: async () => true,
      showBlockedDialog: vi.fn(),
      syncCollection: (p: string, patches: NmlPatch[]) => syncCollection(p, patches, session, BOOT),
      track: (async (_k: unknown, _l: unknown, run: () => Promise<unknown>) => run()) as never,
    }
    const repair = item('t', { ...traktor, entry: { ...ENTRY, entryState: state } })
    expect(await repairDamage([repair], deps({ traktor: real }))).toEqual([
      { id: 't', state: 'repaired' },
    ])
    const once = readFileSync(nmlPath, 'utf8')
    expect(once).toContain('START="10000.000000"')
    expect(await repairDamage([repair], deps({ traktor: real }))).toEqual([
      { id: 't', state: 'unchanged' },
    ])
    expect(readFileSync(nmlPath, 'utf8')).toBe(once)
  })
})

// Paths come from the renderer: a file the app was never handed is never written, whichever
// writer the repair goes through.
describe('repairDamage — paths the app was not handed', () => {
  it('writes no tree and no library row for them', async () => {
    const rewriteTree = vi.fn(async () => ({ written: true }))
    const e = engineDeps([{ written: true }])
    const d = deps({ rewriteTree, engine: e })
    d.genre.allowed = () => false
    const out = await repairDamage(
      [
        item('w', { target: 'traktor', path: WAV, addMs: -51.18, treeFile: WAV, treeMs: [10000] }),
        item('e', engine),
      ],
      d,
    )
    expect(out).toEqual([
      { id: 'w', state: 'failed', error: 'pathNotAllowed' },
      { id: 'e', state: 'failed', error: 'pathNotAllowed' },
    ])
    expect(rewriteTree).not.toHaveBeenCalled()
    expect(e.repointTracks).not.toHaveBeenCalled()
  })
})
