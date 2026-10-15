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

  it('falls back when the file is not a rekordbox database instead of throwing at the renderer', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(withCollection(path, () => 'read', 'none')).toBe('none')
  })

  it('reads a real collection', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(withCollection(path, () => 'read', 'none')).toBe('read')
  })

  it('falls back when the read itself fails, so a schema rekordbox changed does not crash the tree', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(
      withCollection(
        path,
        () => {
          throw new Error('no such column')
        },
        'none',
      ),
    ).toBe('none')
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
