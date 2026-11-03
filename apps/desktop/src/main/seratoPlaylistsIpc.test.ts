import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import type { SourceNode, SourcePlaylistEntry } from '../shared/types'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { registerSeratoPlaylistsIpc } from './seratoPlaylistsIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const now = String(Math.floor(Date.now() / 1000))

function library(): SeratoLibraryRoot {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-seratoipc-')), '_Serato_')
  mkdirSync(join(dir, 'Subcrates'), { recursive: true })
  writeFileSync(
    join(dir, 'database V2'),
    concat([
      track({ pfil: 'Music/a.mp3', tadd: now }),
      track({ pfil: 'Music/b.mp3', tadd: '978307200' }),
    ]),
  )
  writeFileSync(
    join(dir, 'Subcrates', 'Friday.crate'),
    concat([
      frame('otrk', frame('ptrk', utf16be('Music/a.mp3'))),
      frame('otrk', frame('ptrk', utf16be('Music/b.mp3'))),
    ]),
  )
  return { dir, root: '/' }
}

describe('registerSeratoPlaylistsIpc', () => {
  it('says Serato is there only while a library is found, so the tab shows only where Serato ran', () => {
    let roots: SeratoLibraryRoot[] = [library()]
    registerSeratoPlaylistsIpc({ roots: () => roots })
    expect(handler('serato:available')({})).toBe(true)
    roots = []
    expect(handler('serato:available')({})).toBe(false)
  })

  it('reads the libraries found now, since a drive can be plugged in while Surco runs', () => {
    let roots: SeratoLibraryRoot[] = []
    registerSeratoPlaylistsIpc({ roots: () => roots })
    expect(handler('serato:tree')({})).toEqual([])
    expect(handler('serato:recentCount')({})).toBe(0)
    expect(handler('serato:trackCount')({})).toBe(0)
    roots = [library()]
    expect((handler('serato:tree')({}) as SourceNode[]).map((n) => n.name)).toEqual(['Friday'])
    expect(handler('serato:recentCount')({})).toBe(1)
    expect(handler('serato:trackCount')({})).toBe(2)
  })

  it('answers which crates hold each file', () => {
    const roots = [library()]
    registerSeratoPlaylistsIpc({ roots: () => roots })
    expect(handler('serato:membership')({}, ['/Music/a.mp3'])).toEqual({
      '/Music/a.mp3': ['Friday'],
    })
  })

  it('grants the files of the crate it read, so the rows can play before any disk walk', () => {
    const roots = [library()]
    const allowMedia = vi.fn()
    registerSeratoPlaylistsIpc({ roots: () => roots, allowMedia })
    const entries = handler('serato:playlist')({}, 'Friday') as SourcePlaylistEntry[]
    expect(entries.map((e) => e.path)).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
    expect(allowMedia).toHaveBeenCalledWith(['/Music/a.mp3', '/Music/b.mp3'])
  })

  it('says whether Serato is open, so the editor can warn its cues may be out of date', async () => {
    let open = true
    registerSeratoPlaylistsIpc({ roots: () => [], running: async () => open })
    expect(await handler('serato:running')({})).toBe(true)
    open = false
    expect(await handler('serato:running')({})).toBe(false)
  })
})
