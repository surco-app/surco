import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { collectionAvailable, withCollection } from './rekordboxPlaylistsIpc'

describe('withCollection', () => {
  it('falls back when there is no collection, the normal case for a user without rekordbox', () => {
    expect(withCollection('', () => 'read', 'none')).toBe('none')
  })

  // A collection that is there but does not read is not an empty one: answering empty
  // would show "no playlists" and close the open playlist as if it had been deleted.
  it('fails when the file is not a rekordbox database, so the renderer can say it could not read it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(() => withCollection(path, () => 'read', 'none')).toThrow()
  })

  it('reads a real collection', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(withCollection(path, () => 'read', 'none')).toBe('read')
  })

  it('fails when the read itself fails, rekordbox mid-write or a renamed column, rather than answering empty', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(() =>
      withCollection(
        path,
        () => {
          throw new Error('no such column')
        },
        'none',
      ),
    ).toThrow('no such column')
  })
})

// Asked on every focus for the rail: decrypting the whole collection for a yes/no would
// run the SQLCipher key derivation in the main process each time Surco comes back, for
// every user with rekordbox installed. Whether it reads is what the tree reports.
describe('collectionAvailable', () => {
  it('answers from the file being there, without decrypting it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(collectionAvailable(path)).toBe(true)
  })

  it('is false with no collection, or one that is gone', async () => {
    expect(collectionAvailable('')).toBe(false)
    expect(collectionAvailable(join(tmpdir(), 'surco-no-such', 'master.db'))).toBe(false)
  })
})
