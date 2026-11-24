import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-amlocations-'))
  return { app: { getPath: () => dir } }
})

const runOsascript = vi.fn()
vi.mock('./applemusic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applemusic')>()),
  runOsascript: (...a: unknown[]) => runOsascript(...a),
}))

import { rmSync } from 'node:fs'
import { app } from 'electron'
import { readLibraryPlaylist } from './appleMusicPlaylists'

const US = '\u001f'
const RS = '\u001e'
const GS = '\u001d'

type Track = { pid: string; modified: number }

function playlistReply(tracks: Track[]): string {
  const rows = tracks.map((t) =>
    ['', t.pid, '', '0', '', '0', '0', '0', '0', 'computed', String(t.modified)].join(US),
  )
  return `${tracks.length}${GS}${rows.join(RS)}`
}

function serveLibrary(tracks: Track[], paths: Record<string, string>): void {
  runOsascript.mockImplementation(async (script: string) => {
    if (!script.includes('location.path')) return playlistReply(tracks)
    return Object.entries(paths)
      .filter(([pid]) => script.includes(JSON.stringify(pid)))
      .map(([pid, path]) => `${pid}${US}${path}`)
      .join(RS)
  })
}

const locationReads = (): string[] =>
  runOsascript.mock.calls.map((c) => c[0] as string).filter((s) => s.includes('location.path'))

beforeEach(() => {
  runOsascript.mockReset()
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

// Resolving a file location goes through macOS's library service, which asks the NAS file by
// file and serves one read at a time: measured on a cold NAS, 64 s for the 171 tracks added
// lately and almost 4 minutes for the whole library, while the list stayed a skeleton. A
// track's file stays where it was until Music edits it, so each location is resolved once.
describe('reading a playlist from the library database', () => {
  it('resolves no file on the NAS when every track was resolved before', async () => {
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 1 }], { AAAAAAAAAAAAAAA1: '/m/a.aiff' })
    await readLibraryPlaylist('A1B2C3D4E5F60718')
    runOsascript.mockClear()

    const again = await readLibraryPlaylist('A1B2C3D4E5F60718')

    expect(locationReads()).toEqual([])
    expect(again.paths).toEqual(['/m/a.aiff'])
    expect(again.persistentIds).toEqual({ '/m/a.aiff': 'AAAAAAAAAAAAAAA1' })
  })

  it('resolves only the tracks it has never seen', async () => {
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 1 }], { AAAAAAAAAAAAAAA1: '/m/a.aiff' })
    await readLibraryPlaylist('A1B2C3D4E5F60718')
    runOsascript.mockClear()
    serveLibrary(
      [
        { pid: 'BBBBBBBBBBBBBBB2', modified: 5 },
        { pid: 'AAAAAAAAAAAAAAA1', modified: 1 },
      ],
      { AAAAAAAAAAAAAAA1: '/m/a.aiff', BBBBBBBBBBBBBBB2: '/m/b.aiff' },
    )

    const read = await readLibraryPlaylist('A1B2C3D4E5F60718')

    expect(locationReads()).toHaveLength(1)
    expect(locationReads()[0]).toContain('"BBBBBBBBBBBBBBB2"')
    expect(locationReads()[0]).not.toContain('"AAAAAAAAAAAAAAA1"')
    expect(read.paths).toEqual(['/m/b.aiff', '/m/a.aiff'])
  })

  // Music renames and moves the file of a track whose tags it changes when it keeps the media
  // folder organized, and stamps the track as modified when it does.
  it('resolves again a track Music modified since, which may have moved its file', async () => {
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 1 }], { AAAAAAAAAAAAAAA1: '/m/old.aiff' })
    await readLibraryPlaylist('A1B2C3D4E5F60718')
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 2 }], { AAAAAAAAAAAAAAA1: '/m/new.aiff' })

    const read = await readLibraryPlaylist('A1B2C3D4E5F60718')

    expect(read.paths).toEqual(['/m/new.aiff'])
  })

  it('stops showing a track at its old file once Music no longer has one for it', async () => {
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 1 }], { AAAAAAAAAAAAAAA1: '/m/a.aiff' })
    await readLibraryPlaylist('A1B2C3D4E5F60718')
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 2 }], {})

    const read = await readLibraryPlaylist('A1B2C3D4E5F60718')

    expect(read.paths).toEqual([])
    expect(read.missing).toBe(1)
  })

  it('counts a track with no file as missing, as a read from Music does', async () => {
    serveLibrary([{ pid: 'AAAAAAAAAAAAAAA1', modified: 1 }], {})

    const read = await readLibraryPlaylist('A1B2C3D4E5F60718')

    expect(read.paths).toEqual([])
    expect(read.missing).toBe(1)
  })
})
