import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import type { SourceNode, SourcePlaylistEntry } from '../shared/types'
import { registerTraktorPlaylistsIpc } from './traktorPlaylistsIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const today = new Date()
const imported = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY TITLE="A"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="${imported}"></INFO></ENTRY>
<ENTRY TITLE="B"><LOCATION DIR="/:Music/:" FILE="b.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="2001/1/1"></INFO></ENTRY>
</COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="Friday"><PLAYLIST ENTRIES="2" TYPE="LIST" UUID="u1">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:a.mp3"></PRIMARYKEY></ENTRY>
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:b.mp3"></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`

async function collection(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'surco-traktoripc-')), 'collection.nml')
  await writeFile(file, NML)
  return file
}

describe('registerTraktorPlaylistsIpc', () => {
  it('says Traktor is there only while a collection is found, so the tab shows only where Traktor is installed', async () => {
    let found = await collection()
    registerTraktorPlaylistsIpc(() => found, { bootVolume: () => 'HD' })
    expect(handler('traktor:available')({})).toBe(true)
    found = ''
    expect(handler('traktor:available')({})).toBe(false)
  })

  it('reads the collection found now, since the DJ can change it in Settings while Surco runs', async () => {
    const file = await collection()
    let found = ''
    registerTraktorPlaylistsIpc(() => found, { bootVolume: () => 'HD' })
    expect(handler('traktor:tree')({})).toEqual([])
    expect(handler('traktor:recentCount')({})).toBe(0)
    found = file
    expect((handler('traktor:tree')({}) as SourceNode[]).map((n) => n.name)).toEqual(['Friday'])
    expect(handler('traktor:recentCount')({})).toBe(1)
  })

  it('answers which playlists hold each file, and nothing without a collection, so the field can fill in', async () => {
    const file = await collection()
    let found = ''
    registerTraktorPlaylistsIpc(() => found, { bootVolume: () => 'HD' })
    expect(handler('traktor:membership')({}, ['/Music/a.mp3'])).toEqual({})
    found = file
    expect(handler('traktor:membership')({}, ['/Music/a.mp3'])).toEqual({ '/Music/a.mp3': ['u1'] })
  })

  it('fails on a collection it cannot read, so the tab says so instead of showing no playlists', async () => {
    registerTraktorPlaylistsIpc(() => '/nowhere/collection.nml', { bootVolume: () => 'HD' })
    expect(() => handler('traktor:tree')({})).toThrow()
  })

  it('grants the files of the playlist it read, so the rows can play before any disk walk', async () => {
    const file = await collection()
    const allowMedia = vi.fn()
    registerTraktorPlaylistsIpc(() => file, { bootVolume: () => 'HD', allowMedia })
    const entries = handler('traktor:playlist')({}, 'u1') as SourcePlaylistEntry[]
    expect(entries.map((e) => e.path)).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
    expect(allowMedia).toHaveBeenCalledWith(['/Music/a.mp3', '/Music/b.mp3'])
  })
})
