import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { mediaPathFromUrl } from '../shared/media'
import type { SourceNode, SourcePlaylistEntry } from '../shared/types'
import { engineDbPath, writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { registerEnginePlaylistsIpc } from './enginePlaylistsIpc'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

async function library(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-engineipc-'))
  writeEngineLibraryFixture(dir, {
    tracks: [
      { id: 1, path: '../Music/a.mp3', title: 'A', albumArtId: 2 },
      { id: 2, path: '../Music/b.mp3', title: 'B' },
    ],
    art: [{ id: 2, bytes: JPEG }],
    playlists: [{ id: 7, title: 'Friday', parentListId: 0, nextListId: 0 }],
    entities: [
      { id: 1, listId: 7, trackId: 1, nextEntityId: 2 },
      { id: 2, listId: 7, trackId: 2, nextEntityId: 0 },
    ],
  }).close()
  return dir
}

describe('registerEnginePlaylistsIpc', () => {
  it('answers which lists hold each file, and nothing without a library, so the field can fill in', async () => {
    const dir = await library()
    let configured = ''
    registerEnginePlaylistsIpc(() => configured, { artDir: () => join(dir, 'art') })
    const a = resolve(dir, '../Music/a.mp3')
    expect(handler('engine:membership')({}, [a])).toEqual({})
    configured = dir
    expect(handler('engine:membership')({}, [a])).toEqual({ [a]: ['7'] })
  })

  it('says the library is there only when its database is, so the tab can explain where to set it', async () => {
    const dir = await library()
    let configured = dir
    registerEnginePlaylistsIpc(() => configured, { artDir: () => join(dir, 'art') })
    expect(handler('engine:available')({})).toBe(true)
    configured = join(dir, 'elsewhere')
    expect(handler('engine:available')({})).toBe(false)
    configured = ''
    expect(handler('engine:available')({})).toBe(false)
  })

  it('reads the tree of the library set now, since the DJ can change it in Settings while Surco runs', async () => {
    const dir = await library()
    let configured = ''
    registerEnginePlaylistsIpc(() => configured, { artDir: () => join(dir, 'art') })
    expect(handler('engine:tree')({})).toEqual([])
    configured = dir
    expect((handler('engine:tree')({}) as SourceNode[]).map((n) => n.name)).toEqual(['Friday'])
  })

  it('fails on a library that is there but does not read, so the tab says so instead of showing no playlists', async () => {
    const dir = await library()
    await writeFile(engineDbPath(dir), 'not a database')
    registerEnginePlaylistsIpc(() => dir, { artDir: () => join(dir, 'art') })
    expect(() => handler('engine:tree')({})).toThrow()
  })

  it('counts the tracks added in the last 30 days, the number the tree shows beside Recently added', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-engineipc-'))
    const now = Date.now() / 1000
    writeEngineLibraryFixture(dir, {
      tracks: [
        { id: 1, path: 'a.mp3', dateAdded: now - 60 },
        { id: 2, path: 'b.mp3', dateAdded: now - 3600 },
        { id: 3, path: 'c.mp3', dateAdded: now - 90 * 86400 },
      ],
      playlists: [],
      entities: [],
    }).close()
    let configured = ''
    registerEnginePlaylistsIpc(() => configured, { artDir: () => join(dir, 'art') })
    expect(handler('engine:recentCount')({})).toBe(0)
    configured = dir
    expect(handler('engine:recentCount')({})).toBe(2)
  })

  it('grants the files and covers of the playlist it read, so the rows can play and paint before any disk walk', async () => {
    const dir = await library()
    const allowMedia = vi.fn()
    registerEnginePlaylistsIpc(() => dir, { artDir: () => join(dir, 'art'), allowMedia })
    const entries = handler('engine:playlist')({}, '7') as SourcePlaylistEntry[]
    const paths = entries.map((e) => e.path)
    const cover = mediaPathFromUrl(entries[0].preview?.coverUrl as string)
    expect(paths).toHaveLength(2)
    expect(allowMedia).toHaveBeenCalledWith(expect.arrayContaining([...paths, cover]))
  })
})
