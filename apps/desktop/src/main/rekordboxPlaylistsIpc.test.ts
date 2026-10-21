import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { MY_FLOW } from '../shared/cueFlows'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('./rekordboxDb', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rekordboxDb')>()
  return { ...real, openRekordboxDb: vi.fn(real.openRekordboxDb) }
})

import type { SourcePlaylistEntry } from '../shared/types'
import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  collectionAvailable,
  registerRekordboxPlaylistsIpc,
  withCollection,
} from './rekordboxPlaylistsIpc'
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'
import { createRekordboxQueue, type RekordboxQueue } from './rekordboxQueue'
import { registerRekordboxQueueIpc } from './rekordboxQueueIpc'

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
  it('grants the files and covers of the playlist it read, so the rows can play and paint before any disk walk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbipc-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const allowMedia = vi.fn()
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
      allowMedia,
    })
    const entries = (await handler('rekordbox:playlist')({}, '2000')) as SourcePlaylistEntry[]
    const paths = entries.flatMap((e) => (e.path && !e.separator ? [e.path] : []))
    expect(paths.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.separator || e.path === null || e.preview)).toBe(true)
    expect(allowMedia).toHaveBeenCalledWith(expect.arrayContaining(paths))
  })

  it('opens the playlist with the key already stretched, since stretching the passphrase on every open held the main process for 80 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
    })
    vi.mocked(openRekordboxDb).mockClear()
    await handler('rekordbox:playlist')({}, '2000')
    expect(openRekordboxDb).toHaveBeenCalledWith(path, {
      readonly: true,
      key: await rekordboxRawKey(path),
    })
  })

  it('reads the tree and the separator check with the stretched key too, since both run back to back on every focus and held the main process for 226 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
    })
    const key = await rekordboxRawKey(path)
    vi.mocked(openRekordboxDb).mockClear()
    await handler('rekordbox:tree')()
    await handler('rekordbox:hasSeparator')()
    await handler('rekordbox:recentCount')()
    expect(vi.mocked(openRekordboxDb).mock.calls).toEqual([
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
    ])
  })

  it('reads a track opened in the editor, its cues and its playlists, with the stretched key, since the two back to back held the main process for 210 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const queue = queueFor(path)
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    registerRekordboxQueueIpc(queue, {
      collection: () => path,
      ensureClosed: vi.fn(async () => true),
    })
    const key = await rekordboxRawKey(path)
    vi.mocked(openRekordboxDb).mockClear()
    await Promise.resolve(handler('rekordbox:trackCues')({}, 'c1')).catch(() => null)
    await Promise.resolve(handler('rekordbox:membership')({}, ['/m/a.wav'])).catch(() => null)
    expect(vi.mocked(openRekordboxDb).mock.calls).toEqual([
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
    ])
  })

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
    expect(await handler('rekordbox:hasSeparator')()).toBe(true)
  })

  it('counts the tracks added in the last 30 days, the number the tree shows beside Recently added', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    const today = new Date().toLocaleDateString('sv-SE')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c, i) => (i < 2 ? { ...c, StockDate: today } : c)),
    })
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
    })
    expect(await handler('rekordbox:recentCount')()).toBe(2)
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

  it('does not wake the watcher after a refusal that is not rekordbox being open', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onWaiting = vi.fn()
    const queue = {
      enqueue: vi.fn(),
      apply: vi.fn(async () => ({ status: 'refused', reason: 'backup-failed' }) as const),
      drop: vi.fn(),
    }
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue,
      onWaiting,
    })
    const edit = { kind: 'rename', playlistId: '3000', name: 'House 26' }
    expect(await handler('rekordbox:edit')({ sender: {} }, edit)).toEqual({
      applied: false,
      reason: 'backup-failed',
    })
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('takes a refused edit out of the queue, so a retry after "nothing changed" does not write it twice', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const queue = queueFor(
      path,
      vi.fn(async () => {
        throw new Error('disk full')
      }),
    )
    queue.enqueue([
      {
        id: 'other',
        kind: 'edit',
        edit: { kind: 'rename', playlistId: '2000', name: 'Factory 26' },
        stamps: {},
        label: 'Factory',
      },
    ])
    registerRekordboxPlaylistsIpc(() => path, { ensureClosed: vi.fn(async () => true), queue })
    expect(
      await handler('rekordbox:edit')(
        { sender: {} },
        { kind: 'create', parentId: 'root', name: 'Makina 2', folder: false },
        'Makina 2',
      ),
    ).toEqual({ applied: false, reason: 'backup-failed' })
    expect(queue.state().items.map((i) => i.label)).toEqual(['Factory'])
  })

  it("tells the window what the other queued operations did, without the route's own edit", async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const other = { code: 'playlist-changed', track: 'Bam Bam', playlist: 'House' } as const
    const own = { code: 'edit-changed', playlist: 'House' } as const
    const enqueue = vi.fn<RekordboxQueue['enqueue']>()
    const ownId = () => enqueue.mock.calls[0][0][0].id
    const queue = {
      enqueue,
      drop: vi.fn(),
      apply: vi.fn(async () => ({
        status: 'applied' as const,
        tracks: 0,
        changes: 1,
        notices: [own, other],
        written: [{ path: '/m/a.wav', wanted: [] }],
        outcomes: [
          { id: ownId(), applied: false, reason: 'stale' as const, notices: [own] },
          { id: 'e2', applied: true, notices: [] },
          { id: 't', applied: false, notices: [other] },
        ],
      })),
    }
    const onApplied = vi.fn()
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue,
      onApplied,
    })
    await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'rename', playlistId: '3000', name: 'House 26' },
    )
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: 1,
        notices: [other],
        written: [{ path: '/m/a.wav', wanted: [] }],
      }),
    )
  })

  it('tells the window nothing when only its own edit was in the batch', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onApplied = vi.fn()
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
      onApplied,
    })
    await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'rename', playlistId: '3000', name: 'House 26' },
    )
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('wakes the watcher when the edit waits for rekordbox to close', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onWaiting = vi.fn()
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => false),
      queue: queueFor(path),
      onWaiting,
    })
    await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'rename', playlistId: '3000', name: 'House 26' },
    )
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })
})
