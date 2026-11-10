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

function row(program: DjProgram, over: Partial<DjMainProgram['read']> = {}): DjMainProgram {
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
  }
}

function table(over: Partial<Record<DjProgram, Partial<DjMainProgram['read']>>> = {}): DjMainTable {
  return Object.fromEntries(DJ_PROGRAMS.map((p) => [p, row(p, over[p])])) as DjMainTable
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
})
