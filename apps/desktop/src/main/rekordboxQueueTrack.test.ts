import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import type { ContentFacts } from './rekordboxContentAdd'
import { openRekordboxDb } from './rekordboxDb'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import {
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'
import type { TrackOp } from './rekordboxQueueOps'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { applyRekordboxBatch } from './rekordboxPlaylistWrite'

const NOW = new Date('2026-10-18T19:00:00.000Z')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'surco-rbtrack-'))
})

async function collection(over: Partial<PlaylistFixture> = {}): Promise<string> {
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true, ...over })
  return path
}

const deps = () => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  now: () => NOW,
  ...TWIN_PATHS,
})

async function newFile(name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, Buffer.alloc(100))
  return path
}

function facts(path: string): ContentFacts {
  return {
    path,
    fileType: 11,
    fileSize: 100,
    inode: '12345',
    createdMs: NOW.getTime(),
    durationSec: 300,
    sampleRate: 44100,
    bitDepth: 16,
    bitRateKbps: 1411,
    meta: rekordboxMetaFrom({ ...emptyMetadata(), title: 'Bam Bam', artist: 'Sister Nancy' }),
  }
}

function op(over: Partial<TrackOp>): TrackOp {
  return {
    id: 't',
    kind: 'track',
    path: '/Volumes/Public/Music/Gowan.wav',
    label: 'Bam Bam',
    facts: null,
    wanted: [],
    known: [],
    stamps: { '2000': 1767225600000, '3000': 1767225600000 },
    ...over,
  }
}

function read<T>(path: string, sql: string, ...args: string[]): T[] {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return db.prepare(sql).all(...args) as T[]
  } finally {
    db.close()
  }
}

const contentsOf = (path: string, playlistId: string) =>
  read<{ ContentID: string }>(
    path,
    'SELECT ContentID FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo',
    playlistId,
  ).map((r) => r.ContentID)

const named = (path: string, name: string) =>
  read<{ ID: string; ParentID: string }>(
    path,
    'SELECT ID, ParentID FROM djmdPlaylist WHERE Name = ?',
    name,
  )

describe('track operations', () => {
  it('adds a new track to the collection, to an existing playlist and to a new one', async () => {
    const path = await collection()
    const file = await newFile('Bam Bam.wav')
    const result = await applyRekordboxBatch(
      path,
      [
        op({
          path: file,
          facts: facts(file),
          wanted: [{ id: '3000', name: 'House' }, { name: 'Bolos' }],
        }),
      ],
      deps(),
    )
    const entry = result.ok ? result.outcomes[0].contentId : undefined
    expect(result.ok && result.outcomes[0]).toMatchObject({ applied: true, notices: [] })
    expect(contentsOf(path, '3000')).toEqual(['102', '110', entry])
    const [bolos] = named(path, 'Bolos')
    expect(bolos.ParentID).toBe('root')
    expect(contentsOf(path, bolos.ID)).toEqual([entry])
    const xml = await readFile(join(dir, 'masterPlaylists6.xml'), 'utf8')
    expect(xml).toContain(`Id="${BigInt(bolos.ID).toString(16).toUpperCase()}" ParentId="0"`)
    expect(xml).toMatch(new RegExp(`Id="BB8" [^>]*Timestamp="${NOW.getTime()}"`))
    expect(xml).toMatch(/Id="7D0" [^>]*Timestamp="1767225600000"/)
  })

  it('reuses the entry rekordbox already has for the file so the cues and history on it survive', async () => {
    const path = await collection()
    const before = read(path, 'SELECT ID FROM djmdContent').length
    await applyRekordboxBatch(path, [op({ wanted: [{ id: '3000', name: 'House' }] })], deps())
    expect(read(path, 'SELECT ID FROM djmdContent')).toHaveLength(before)
    expect(contentsOf(path, '3000')).toEqual(['102', '110', '103'])
  })

  it('takes the track out of every link of the playlists it is no longer wanted in and keeps the entry', async () => {
    const path = await collection()
    await applyRekordboxBatch(
      path,
      [
        op({
          path: '/Volumes/Public/Music/Play This Song.wav',
          wanted: [{ id: '3000', name: 'House' }],
          known: ['2000', '3000'],
        }),
      ],
      deps(),
    )
    expect(contentsOf(path, '2000')).toEqual(['101', '109', '201', '109', '104'])
    expect(contentsOf(path, '3000')).toEqual(['102', '110'])
  })

  it('leaves alone a playlist rekordbox changed since the track was queued, and says so', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [op({ wanted: [{ id: '3000', name: 'House' }], stamps: { '3000': 1 } })],
      deps(),
    )
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-changed', track: 'Bam Bam', playlist: 'House' },
    ])
    expect(contentsOf(path, '3000')).toEqual(['102', '110'])
  })

  it('never removes the track from a playlist it joined in rekordbox after queueing', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [
        op({
          path: '/Volumes/Public/Music/Play This Song.wav',
          wanted: [{ id: '3000', name: 'House' }],
          known: ['3000'],
        }),
      ],
      deps(),
    )
    expect(contentsOf(path, '2000')).toContain('102')
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-changed', track: 'Bam Bam', playlist: 'Factory' },
    ])
  })

  it('says a wanted playlist is gone and applies the rest', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [
        op({
          wanted: [
            { id: '9999', name: 'Makina' },
            { id: '3000', name: 'House' },
          ],
        }),
      ],
      deps(),
    )
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-gone', track: 'Bam Bam', playlist: 'Makina' },
    ])
    expect(contentsOf(path, '3000')).toContain('103')
  })

  it('skips a file the collection holds twice and says so', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(
      path,
      [op({ path: '/Users/dj/Music/Music/Ekkah.wav', wanted: [{ id: '3000', name: 'House' }] })],
      d,
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 't', applied: false, notices: [{ code: 'ambiguous', track: 'Bam Bam' }] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('adds nothing for a file deleted before rekordbox closed', async () => {
    const path = await collection()
    const gone = join(dir, 'gone.wav')
    const result = await applyRekordboxBatch(
      path,
      [op({ path: gone, facts: facts(gone), wanted: [{ id: '3000', name: 'House' }] })],
      deps(),
    )
    expect(result.ok && result.outcomes[0]).toEqual({
      id: 't',
      applied: false,
      notices: [{ code: 'file-missing', track: 'Bam Bam' }],
    })
  })

  it('creates a new playlist name once per batch so two tracks converted together share it', async () => {
    const path = await collection()
    const a = await newFile('a.wav')
    const b = await newFile('b.wav')
    await applyRekordboxBatch(
      path,
      [
        op({ id: 'a', path: a, facts: facts(a), wanted: [{ name: 'Bolos' }] }),
        op({
          id: 'b',
          path: b,
          facts: { ...facts(b), inode: '6789' },
          wanted: [{ name: 'Bolos' }],
        }),
      ],
      deps(),
    )
    const rows = named(path, 'Bolos')
    expect(rows).toHaveLength(1)
    expect(contentsOf(path, rows[0].ID)).toHaveLength(2)
  })

  it('checks no Timestamp when the collection has no XML (rekordbox 5)', async () => {
    const path = await collection({ xml: false })
    await applyRekordboxBatch(
      path,
      [op({ wanted: [{ id: '3000', name: 'House' }], stamps: { '3000': 1 } })],
      deps(),
    )
    expect(contentsOf(path, '3000')).toContain('103')
  })

  it('drops a playlist part whose Timestamp moved while rekordbox was being closed', async () => {
    const path = await collection()
    const xmlPath = join(dir, 'masterPlaylists6.xml')
    const d = deps()
    d.ensureClosed.mockImplementation(async () => {
      const text = await readFile(xmlPath, 'utf8')
      await writeFile(xmlPath, text.replace(/(Id="BB8" [^>]*Timestamp=")\d+/, '$11'))
      return true
    })
    const result = await applyRekordboxBatch(
      path,
      [
        op({
          wanted: [
            { id: '3000', name: 'House' },
            { id: '2000', name: 'Factory' },
          ],
        }),
      ],
      d,
    )
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-changed', track: 'Bam Bam', playlist: 'House' },
    ])
    expect(contentsOf(path, '3000')).toEqual(['102', '110'])
    expect(contentsOf(path, '2000')).toContain('103')
  })

  it('keeps the track in the playlist created by an earlier batch instead of creating the name again', async () => {
    const path = await collection()
    const file = await newFile('Bam Bam.wav')
    const track = op({ path: file, facts: facts(file), wanted: [{ name: 'Bolos' }] })
    await applyRekordboxBatch(path, [track], deps())
    await applyRekordboxBatch(path, [track], deps())
    const rows = named(path, 'Bolos')
    expect(rows).toHaveLength(1)
    expect(contentsOf(path, rows[0].ID)).toHaveLength(1)
  })

  it('does not add a new track to the collection when every playlist it wanted is gone', async () => {
    const path = await collection()
    const file = await newFile('Bam Bam.wav')
    const before = read(path, 'SELECT ID FROM djmdContent').length
    const result = await applyRekordboxBatch(
      path,
      [op({ path: file, facts: facts(file), wanted: [{ id: '9999', name: 'Makina' }] })],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        {
          id: 't',
          applied: false,
          notices: [{ code: 'playlist-gone', track: 'Bam Bam', playlist: 'Makina' }],
        },
      ],
    })
    expect(read(path, 'SELECT ID FROM djmdContent')).toHaveLength(before)
  })
})
