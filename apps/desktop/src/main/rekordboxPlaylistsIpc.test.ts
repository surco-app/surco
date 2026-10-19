import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  collectionAvailable,
  registerRekordboxPlaylistsIpc,
  withCollection,
} from './rekordboxPlaylistsIpc'
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'
import { createRekordboxQueue } from './rekordboxQueue'

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

function queueFor(path: string, sessionBackup = vi.fn(async () => {})) {
  let text: string | null = null
  return createRekordboxQueue({
    store: {
      read: () => text,
      write: (t) => {
        text = t
      },
      setAside: () => {
        text = null
      },
    },
    collection: () => path,
    applyBatch: (c, ops, ensureClosed) =>
      applyRekordboxBatch(c, ops, { ensureClosed, sessionBackup }),
    repoint: async () => [],
    nodeStamps: async () => ({}),
    onChange: () => {},
  })
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerRekordboxPlaylistsIpc', () => {
  // The dialog asking to close rekordbox must sit over the window the user was dragging in.
  it('asks to close rekordbox over the window that made the edit, then writes', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const ensureClosed = vi.fn(async () => true)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed,
      queue: queueFor(path),
    })
    const result = await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' },
    )
    expect(ensureClosed).toHaveBeenCalledWith('window')
    expect(result).toEqual({ applied: true })
  })

  it('says whether the collection has a separator to copy', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
    })
    expect(handler('rekordbox:hasSeparator')()).toBe(true)
  })

  // The write's transaction spans an await: two at once would fight over SQLite's busy
  // timeout, so the second must not even ask to close rekordbox until the first is done.
  it('runs two edits sent at once one after the other', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    const ensureClosed = vi.fn(async () => {
      const n = ++calls
      order.push(`start${n}`)
      if (n === 1) await gate
      order.push(`end${n}`)
      return true
    })
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed,
      queue: queueFor(path),
    })
    const edit = handler('rekordbox:edit')
    const first = edit(
      { sender: {} },
      { kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' },
    )
    const second = edit(
      { sender: {} },
      { kind: 'move', playlistId: '2000', linkIds: ['f5'], beforeLinkId: 'f1' },
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(order).toEqual(['start1'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('keeps a cancelled edit queued', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const queue = queueFor(path)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => false),
      queue,
    })
    const result = await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'rename', playlistId: '3000', name: 'House 26' },
      'House',
    )
    expect(result).toEqual({ applied: false, reason: 'cancelled' })
    expect(queue.state().items).toEqual([
      {
        key: expect.stringMatching(/^edit:/),
        label: 'House',
        parts: [{ kind: 'tree', edit: 'rename' }],
      },
    ])
  })
})
