import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openEngineDb } from './enginePlaylists'
import { type EngineFixture, writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { artworkFileName, readEngineUsbSelection } from './engineUsbSource'

async function opened(data: EngineFixture) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-engineusb-'))
  writeEngineLibraryFixture(dir, data).close()
  const db = openEngineDb(dir)
  if (!db) throw new Error('fixture did not open')
  return { dir, db }
}

const LIBRARY: EngineFixture = {
  tracks: [
    { id: 1, path: '../Music/Night Train.aiff', title: 'Night Train', artist: 'Rebel' },
    { id: 2, path: '../Music/Play.mp3', title: 'Play', artist: 'Safri' },
    { id: 3, path: '../Music/Third.flac', title: 'Third', artist: 'Glen' },
    { id: 4, path: null, title: 'Streamed', artist: 'Cloud' },
  ],
  playlists: [
    { id: 1, title: 'Warm up', parentListId: 0, nextListId: 2 },
    { id: 2, title: 'Sets', parentListId: 0, nextListId: 0 },
    { id: 3, title: 'Peak', parentListId: 2, nextListId: 4 },
    { id: 4, title: 'Closing', parentListId: 2, nextListId: 0 },
  ],
  entities: [
    { id: 1, listId: 1, trackId: 2, nextEntityId: 2 },
    { id: 2, listId: 1, trackId: 1, nextEntityId: 0 },
    { id: 3, listId: 3, trackId: 1, nextEntityId: 4 },
    { id: 4, listId: 3, trackId: 4, nextEntityId: 0 },
    { id: 5, listId: 4, trackId: 3, nextEntityId: 0 },
  ],
}

describe('readEngineUsbSelection', () => {
  it('takes the ticked playlists in the order Engine plays them, so the USB playlist runs like the desktop one', async () => {
    const { db } = await opened(LIBRARY)
    const sel = readEngineUsbSelection(db, '', ['1'])
    expect(sel.playlists).toEqual([{ id: '1', name: 'Warm up', folders: [], trackIds: [2, 1] }])
    expect(sel.tracks.map((t) => t.id)).toEqual([2, 1])
    db.close()
  })

  it('takes every playlist of a ticked folder with the folder names, so the USB keeps the same folders', async () => {
    const { db } = await opened(LIBRARY)
    const sel = readEngineUsbSelection(db, '', ['2', '1'])
    expect(sel.playlists.map((p) => [p.folders, p.name, p.trackIds])).toEqual([
      [[], 'Warm up', [2, 1]],
      [['Sets'], 'Peak', [1, 4]],
      [['Sets'], 'Closing', [3]],
    ])
    expect(sel.tracks.map((t) => t.id)).toEqual([2, 1, 4, 3])
    db.close()
  })

  it('resolves each file against the library folder as Engine does, and leaves a streamed track without one', async () => {
    const { dir, db } = await opened(LIBRARY)
    const sel = readEngineUsbSelection(db, dir, ['3'])
    expect(sel.tracks).toEqual([
      expect.objectContaining({
        id: 1,
        title: 'Night Train',
        artist: 'Rebel',
        path: resolve(dir, '../Music/Night Train.aiff'),
      }),
      expect.objectContaining({ id: 4, title: 'Streamed', path: null }),
    ])
    db.close()
  })
})

describe('artworkFileName', () => {
  it('names the image as Engine DJ 4 does in its Artwork folder, the hash in URL-safe base64', () => {
    const hash = Buffer.from('f8a7dcaa49e456914f24038b5a9f36c5fcf921b7', 'hex')
    expect(artworkFileName(hash)).toBe('-KfcqknkVpFPJAOLWp82xfz5Ibc')
  })

  it('has no name for a cover kept inside the database, as older libraries store it', () => {
    expect(artworkFileName('3f786850e387550fdab836ed7e6dc881de23001b')).toBeNull()
    expect(artworkFileName(null)).toBeNull()
  })
})
