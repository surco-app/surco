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
  }
}

function table(
  over: Partial<Record<DjProgram, Partial<DjMainProgram['read']>>> = {},
  edits: Partial<Record<DjProgram, DjMainProgram['edit']>> = {},
): DjMainTable {
  return Object.fromEntries(DJ_PROGRAMS.map((p) => [p, row(p, over[p], edits[p])])) as DjMainTable
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
})
