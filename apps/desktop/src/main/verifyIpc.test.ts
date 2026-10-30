import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() },
}))

const OPENED = vi.hoisted(() => [] as { path: string; readonly: boolean; closed: boolean }[])
vi.mock('./rekordboxDb', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rekordboxDb')>()
  return {
    ...real,
    openRekordboxDb: (path: string, options?: { readonly?: boolean }) => {
      const db = real.openRekordboxDb(path, options)
      if (!db) return db
      const seen = { path, readonly: options?.readonly === true, closed: false }
      OPENED.push(seen)
      const close = db.close.bind(db)
      db.close = () => {
        seen.closed = true
        return close()
      }
      return db
    },
  }
})

import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import { makeRekordbox } from '../scenarios/rekordboxFixture'
import type { Verification } from '../shared/verification'
import {
  libraryReaders,
  registerVerifyIpc,
  snapshotLibraries,
  verifyUpdateSender,
} from './verifyIpc'
import { createVerifyRegistry, type VerifyEntry, type VerifyRegistryDeps } from './verifyRegistry'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => Promise<unknown> {
  const call = vi.mocked(ipcMain.handle).mock.calls.findLast(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as (e: unknown, ...args: unknown[]) => Promise<unknown>
}

const contents = (destroyed = false) => {
  const send = vi.fn<WebContents['send']>()
  return { send, isDestroyed: () => destroyed } as unknown as WebContents & { send: typeof send }
}

const realPath = (p: string) => p
const FROM = '/Volumes/Music/Artist/Title.aiff'
const TO = '/Volumes/Music/Artist/Title.wav'

const entry = (over: Partial<VerifyEntry> = {}): VerifyEntry => ({
  trackId: 'a',
  from: FROM,
  source: FROM,
  to: TO,
  samplesKept: true,
  originalKept: false,
  places: new Set(['file', 'rekordbox']),
  file: {
    path: TO,
    ext: '.wav',
    codec: 'pcm_s16le',
    samplesKept: true,
    trimmedSec: 0,
    tags: {},
    cover: 'untouched',
  },
  verification: { status: 'checking', checks: [] },
  ...over,
})

const collection = () =>
  makeRekordbox(join(mkdtempSync(join(tmpdir(), 'surco-verifyipc-')), 'rekordbox'), [
    { id: '100', path: FROM, title: 'Title', artist: 'Artist', fileType: 12, cuesMs: [1000, 2000] },
  ])

describe('verify IPC', () => {
  // The preload hands the renderer (trackId, verification) as two arguments, like the
  // progress events: every open window hears it, a closed one is skipped.
  it('a verify:update reaches the window that converted', () => {
    const open = contents()
    const closed = contents(true)
    const v: Verification = { status: 'ok', checks: [], job: 'j', seq: 1 }

    verifyUpdateSender(() => [open, closed])('a', v)

    expect(open.send).toHaveBeenCalledWith('verify:update', 'a', v)
    expect(closed.send).not.toHaveBeenCalled()
  })

  // A track main no longer knows (the app restarted since the conversion) cannot be
  // re-read: the renderer is told so by key, not left waiting.
  it('verify:retry with an unknown track id rejects with an error key', async () => {
    const deps = {} as VerifyRegistryDeps
    registerVerifyIpc(createVerifyRegistry(deps))

    await expect(handlerFor('verify:retry')({}, 'nope')).rejects.toThrow('verifyUnknownTrack')
    await expect(handlerFor('verify:retry')({}, 42)).rejects.toThrow('verifyUnknownTrack')
  })

  it('verify:retry answers what the registry decided', async () => {
    const retry = vi.fn(async () => 'rerun-job' as const)
    registerVerifyIpc({ retry })

    await expect(handlerFor('verify:retry')({}, 'a')).resolves.toBe('rerun-job')
    expect(retry).toHaveBeenCalledWith('a')
  })
})

describe('library readers', () => {
  // An open handle keeps the next write's wal_checkpoint busy, which fails its backup: the
  // read closes the collection as soon as it has its answer.
  it('reads rekordbox read-only and closes it right after', async () => {
    const path = collection()
    const readers = libraryReaders(
      { rekordbox: () => path, engine: () => '', traktor: () => '' },
      { realPath, bootVolume: () => 'Macintosh HD' },
    )
    OPENED.length = 0

    const results = await readers.readRekordbox([
      entry({ rekordbox: { id: '100', cues: 2, analysisDataPath: '', analysed: 0 } }),
    ])

    expect(results).toEqual([
      {
        place: 'rekordbox',
        state: 'mismatch',
        detail: { key: 'rekordboxStillOld', params: { format: 'AIFF' } },
      },
    ])
    expect(OPENED).toEqual([{ path, readonly: true, closed: true }])
  })

  it('a library that is not there reads as unreadable', async () => {
    const readers = libraryReaders(
      { rekordbox: () => '', engine: () => '', traktor: () => '' },
      { realPath, bootVolume: () => 'Macintosh HD' },
    )

    expect(await readers.readRekordbox([entry()])).toBe('unreadable')
    expect(await readers.readEngine([entry()])).toBe('unreadable')
    expect(await readers.readTraktor([])).toBe('unreadable')
  })

  // The Engine row the job's own Engine DJ step wrote has no snapshot: it only has to be on
  // the written file.
  it('an Engine row the job added is checked as added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-engine-'))
    const seen: unknown[] = []
    const readers = libraryReaders(
      { rekordbox: () => '', engine: () => dir, traktor: () => '' },
      {
        realPath,
        bootVolume: () => 'Macintosh HD',
        openEngine: () => ({ close: () => {} }) as never,
        checkEngine: (_db, _dir, list) => {
          seen.push(...list)
          return list.map(() => ({ place: 'engine', state: 'ok', detail: { key: 'engineOk' } }))
        },
      },
    )

    await readers.readEngine([
      entry({ engineStep: true, engine: 'absent' }),
      entry({ engineStep: true, engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' } }),
      entry({ engine: 'unreadable' }),
    ])

    expect(seen.map((e) => (e as { added: boolean }).added)).toEqual([true, false, false])
  })
})

describe('snapshotLibraries', () => {
  it('takes the source row from the libraries in play and closes them', async () => {
    const path = collection()
    const before = await snapshotLibraries(FROM, { rekordbox: path, engine: '' }, realPath)

    expect(before).toEqual({
      rekordbox: { id: '100', cues: 2, analysisDataPath: '', analysed: 0 },
    })
  })

  // A conversion must never fail because a library could not be read before it.
  it('never rejects: a library it cannot open is unreadable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-broken-'))
    mkdirSync(join(dir, 'Database2', 'm.db'), { recursive: true })
    const garbage = join(dir, 'master.db')
    writeFileSync(garbage, 'not a database either')

    const before = await snapshotLibraries(FROM, { rekordbox: garbage, engine: dir }, realPath)

    expect(before).toEqual({ rekordbox: 'unreadable', engine: 'unreadable' })
  })
})
