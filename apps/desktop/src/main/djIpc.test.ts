import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import type { DjMainProgram, DjMainTable } from '../shared/djApi'
import { DJ_PROGRAMS, type DjProgram } from '../shared/djProgram'
import type { SourceNode } from '../shared/types'
import { registerDjIpc } from './djIpc'

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

function row(
  program: DjProgram,
  over: Partial<DjMainProgram['read']> = {},
  edit?: DjMainProgram['edit'],
  cueQueue?: DjMainProgram['cueQueue'],
): DjMainProgram {
  return {
    read: {
      available: () => true,
      tree: () => [{ id: program } as SourceNode],
      recentCount: () => 0,
      trackCount: () => 0,
      playlist: () => [],
      membership: () => ({}),
      collection: () => [],
      ...over,
    },
    ...(edit ? { edit } : {}),
    ...(cueQueue ? { cueQueue } : {}),
  }
}

function table(
  over: Partial<Record<DjProgram, Partial<DjMainProgram['read']>>> = {},
  edits: Partial<Record<DjProgram, DjMainProgram['edit']>> = {},
  queues: Partial<Record<DjProgram, DjMainProgram['cueQueue']>> = {},
): DjMainTable {
  return Object.fromEntries(
    DJ_PROGRAMS.map((p) => [p, row(p, over[p], edits[p], queues[p])]),
  ) as DjMainTable
}

describe('registerDjIpc', () => {
  it('dispatches each read to the row of the program it names, so one channel serves every program', async () => {
    registerDjIpc(table())
    expect(await handler('dj:tree')({}, 'serato')).toEqual([{ id: 'serato' }])
    expect(await handler('dj:tree')({}, 'rekordbox')).toEqual([{ id: 'rekordbox' }])
  })

  it('passes the arguments after the program through, so each program receives what the caller asked', async () => {
    const playlist = vi.fn(() => [])
    const membership = vi.fn(() => ({}))
    registerDjIpc(table({ traktor: { playlist, membership } }))
    await handler('dj:playlist')({}, 'traktor', 'p1')
    await handler('dj:membership')({}, 'traktor', ['/a'])
    expect(playlist).toHaveBeenCalledWith('p1')
    expect(membership).toHaveBeenCalledWith(['/a'])
  })

  it('rejects an operation the program does not have, so a missing capability is never a silent empty answer', async () => {
    registerDjIpc(table({ engine: { collection: undefined } }))
    await expect(handler('dj:collection')({}, 'engine')).rejects.toThrow('engine has no collection')
  })

  it('rejects a program it does not know, so a typo cannot reach another program', async () => {
    registerDjIpc(table())
    await expect(handler('dj:tree')({}, 'virtualdj')).rejects.toThrow(
      'unknown DJ program virtualdj',
    )
  })

  it('dispatches a playlist edit with its label to the program it names, with the window it came from', async () => {
    const save = vi.fn(async () => ({ applied: true }) as const)
    const other = vi.fn(async () => ({ applied: true }) as const)
    registerDjIpc(table({}, { traktor: { save }, serato: { save: other } }))
    const edit = { kind: 'delete', playlistId: 'p1' } as const
    const sender = { id: 7 }
    expect(await handler('dj:editPlaylist')({ sender }, 'traktor', edit, 'Friday')).toEqual({
      applied: true,
    })
    expect(save).toHaveBeenCalledWith(edit, 'Friday', sender)
    expect(other).not.toHaveBeenCalled()
  })

  it('asks the program whether it has a separator', async () => {
    const hasSeparator = vi.fn(() => true)
    registerDjIpc(
      table({}, { rekordbox: { save: vi.fn(), hasSeparator } as unknown as DjMainProgram['edit'] }),
    )
    expect(await handler('dj:hasSeparator')({}, 'rekordbox')).toBe(true)
  })

  it('rejects an edit for a program that cannot edit, so Engine never answers as if it had saved', async () => {
    registerDjIpc(table())
    await expect(
      handler('dj:editPlaylist')({ sender: {} }, 'engine', { kind: 'delete', playlistId: 'p' }),
    ).rejects.toThrow('engine has no editPlaylist')
  })

  it('serves each cue queue operation from the row of the program it names, so no program answers for another queue', async () => {
    const state = { tracks: 2, changes: 1, items: [] }
    const applied = { tracks: 2, changes: 1, notices: [], written: [] }
    const queue = (name: string) => ({
      read: vi.fn(() => ({ ...state, tracks: name.length })),
      apply: vi.fn(async () => applied),
      discard: vi.fn(async () => {}),
      ready: vi.fn(),
    })
    const engine = queue('engine')
    const serato = queue('serato')
    registerDjIpc(table({}, {}, { engine, serato }))
    const sender = { id: 3 }
    expect(await handler('dj:cueQueue')({}, 'engine')).toEqual({ ...state, tracks: 6 })
    expect(await handler('dj:applyCueQueue')({ sender }, 'engine')).toEqual(applied)
    expect(engine.apply).toHaveBeenCalledWith(sender)
    await handler('dj:discardCueQueue')({}, 'engine')
    await handler('dj:cueQueueReady')({}, 'engine')
    expect(engine.discard).toHaveBeenCalled()
    expect(engine.ready).toHaveBeenCalled()
    expect(serato.read).not.toHaveBeenCalled()
    expect(serato.apply).not.toHaveBeenCalled()
    expect(serato.discard).not.toHaveBeenCalled()
    expect(serato.ready).not.toHaveBeenCalled()
  })

  it('rejects a cue queue operation for a program without a queue', async () => {
    registerDjIpc(table())
    await expect(handler('dj:cueQueue')({}, 'engine')).rejects.toThrow('engine has no cueQueue')
    await expect(handler('dj:applyCueQueue')({ sender: {} }, 'engine')).rejects.toThrow(
      'engine has no applyCueQueue',
    )
  })
})
