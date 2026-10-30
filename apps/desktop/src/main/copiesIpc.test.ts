import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
}))

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type { DjProgram, ProgramCopies } from '../shared/types'
import { type CopiesProgram, registerCopiesIpc } from './copiesIpc'
import { setLibraryBackupRoot } from './libraryBackups'
import { takeCopy } from './libraryHistory'
import { serialLibraryFlush } from './libraryTagSync'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => Promise<unknown> {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.findLast(
    ([ch]) => ch === channel,
  )
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1]
}

function program(over: Partial<CopiesProgram> = {}): CopiesProgram {
  return {
    collectionPath: () => null,
    untouched: () => false,
    session: {
      ensure: async () => {},
      begin: () => {},
      beginLoose: () => {},
      inRunFlush: () => {},
      failed: () => new Set(),
    },
    queue: { state: () => ({ tracks: 0, changes: 0 }), discard: vi.fn() },
    ensureClosed: async () => true,
    isRunning: async () => false,
    pendingLog: () => false,
    ...over,
  }
}

function programs(over: Partial<Record<DjProgram, Partial<CopiesProgram>>> = {}) {
  return {
    rekordbox: program(over.rekordbox),
    traktor: program(over.traktor),
    engine: program(over.engine),
  }
}

let dir: string
let broadcast: ReturnType<typeof vi.fn<(channel: string, payload: unknown) => void>>

function collection(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, name)
  return path
}

beforeEach(() => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'copies-ipc-'))
  const root = join(dir, 'backups')
  mkdirSync(root)
  setLibraryBackupRoot(root)
  broadcast = vi.fn()
})

async function status(): Promise<ProgramCopies[]> {
  return (await handlerFor('copies:status')({})) as ProgramCopies[]
}

describe('copies:status', () => {
  it('lists only the current collection copies, so a DJ who moved to a new Traktor version does not see the old one', async () => {
    const oldNml = collection('traktor-4.4.nml')
    const newNml = collection('traktor-4.5.nml')
    await takeCopy(oldNml, [], 'run', 1000)
    registerCopiesIpc(
      programs({ traktor: { collectionPath: () => newNml } }),
      broadcast,
      () => false,
    )
    const [traktor] = await status()
    expect(traktor.collectionPath).toBe(newNml)
    expect(traktor.copies).toEqual([])
  })

  it('lists only programs found on this machine', async () => {
    registerCopiesIpc(
      programs({ engine: { collectionPath: () => collection('m.db') } }),
      broadcast,
      () => false,
    )
    expect((await status()).map((p) => p.program)).toEqual(['engine'])
  })

  it('reports waiting changes and a halted queue per program', async () => {
    registerCopiesIpc(
      programs({
        rekordbox: {
          collectionPath: () => collection('master.db'),
          queue: { state: () => ({ tracks: 2, changes: 3, halted: true }), discard: vi.fn() },
        },
        engine: { collectionPath: () => collection('m.db') },
      }),
      broadcast,
      () => false,
    )
    const [rekordbox, engine] = await status()
    expect(rekordbox).toMatchObject({ pending: 5, halted: true })
    expect(engine).toMatchObject({ pending: 0, halted: false })
  })

  it('reports a failed copy so the screen can warn before the next write', async () => {
    const path = collection('master.db')
    registerCopiesIpc(
      programs({
        rekordbox: {
          collectionPath: () => path,
          session: {
            ensure: async () => {},
            begin: () => {},
            beginLoose: () => {},
            inRunFlush: () => {},
            failed: () => new Set([path]),
          },
        },
      }),
      broadcast,
      () => false,
    )
    expect((await status())[0].copyFailed).toBe(true)
  })

  it('marks a program the DJ set to "No tocar" as untouched but still lists its copies', async () => {
    const path = collection('collection.nml')
    await takeCopy(path, [], 'run', 1000)
    registerCopiesIpc(
      programs({ traktor: { collectionPath: () => path, untouched: () => true } }),
      broadcast,
      () => false,
    )
    const [traktor] = await status()
    expect(traktor.untouched).toBe(true)
    expect(traktor.copies).toHaveLength(1)
  })
})

describe('copies:restore', () => {
  it('restoring broadcasts copies:changed so the screen refreshes', async () => {
    const path = collection('collection.nml')
    registerCopiesIpc(programs({ traktor: { collectionPath: () => path } }), broadcast, () => false)
    const result = await handlerFor('copies:restore')({ sender: {} }, 'traktor', 'nope')
    expect(result).toEqual({ ok: false, reason: 'not-found' })
    expect(broadcast).toHaveBeenCalledWith('copies:changed', null)
  })

  it('restores the chosen copy and discards the waiting queue', async () => {
    const path = collection('collection.nml')
    const copy = await takeCopy(path, [], 'run', 1000)
    writeFileSync(path, 'changed')
    const discard = vi.fn()
    registerCopiesIpc(
      programs({
        traktor: {
          collectionPath: () => path,
          queue: { state: () => ({ tracks: 0, changes: 0 }), discard },
        },
      }),
      broadcast,
      () => false,
    )
    const result = await handlerFor('copies:restore')({ sender: {} }, 'traktor', copy.id)
    expect(result).toEqual({ ok: true })
    expect(discard).toHaveBeenCalled()
  })

  it('a library flush that arrives during a restore waits for it and finds the waiting changes gone', async () => {
    const path = collection('collection.nml')
    const copy = await takeCopy(path, [], 'run', 1000)
    writeFileSync(path, 'changed')
    let waiting = ['cue']
    let letClose: (closed: boolean) => void = () => {}
    const closing = new Promise<boolean>((resolve) => {
      letClose = resolve
    })
    registerCopiesIpc(
      programs({
        traktor: {
          collectionPath: () => path,
          ensureClosed: () => closing,
          queue: {
            state: () => ({ tracks: 0, changes: waiting.length }),
            discard: () => {
              waiting = []
            },
          },
        },
      }),
      broadcast,
      () => false,
    )
    const restoring = handlerFor('copies:restore')({ sender: {} }, 'traktor', copy.id)
    await Promise.resolve()
    const flushed = serialLibraryFlush(async () => {
      const found = waiting.length
      if (found > 0) writeFileSync(path, 'queued write')
      return found
    })
    letClose(true)
    expect(await restoring).toEqual({ ok: true })
    expect(await flushed).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('collection.nml')
  })

  it('refuses while Surco is converting, because the run writes the library outside the flush chain', async () => {
    const path = collection('collection.nml')
    const copy = await takeCopy(path, [], 'run', 1000)
    writeFileSync(path, 'changed')
    registerCopiesIpc(programs({ traktor: { collectionPath: () => path } }), broadcast, () => true)
    expect(await handlerFor('copies:restore')({ sender: {} }, 'traktor', copy.id)).toEqual({
      ok: false,
      reason: 'busy',
    })
    expect(readFileSync(path, 'utf8')).toBe('changed')
  })
})
