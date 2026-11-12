import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))

import { checkVirtualdj, snapshotVirtualdjSong } from './verifyVirtualdj'
import { virtualdjLibraryRoots } from './virtualdjLibrary'
import { repointVirtualdjTracks } from './virtualdjTrackWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const FROM = '/Music/Serato Pruebas/Pray.mp3'
const LISTED = '/Music/VirtualDJ Pruebas/Pray.flac'

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-verify-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  const volumes = join(base, 'Volumes')
  mkdirSync(volumes)
  const music = join(base, 'Music')
  mkdirSync(music)
  const roots = () => virtualdjLibraryRoots(dir, volumes)
  const to = join(music, 'Pray.aiff')
  writeFileSync(to, 'aiffdata')
  const deps = {
    backupDir: join(base, 'virtualdj-backups'),
    roots,
    virtualdjOpen: vi.fn(async () => false),
    lengthOf: vi.fn(async () => 500),
  }
  return { dir, roots, to, deps }
}

describe('snapshotVirtualdjSong', () => {
  it('names the lists that hold the source before anything writes, and absent for a file VirtualDJ never had', () => {
    const lib = library()
    expect(snapshotVirtualdjSong(lib.roots(), FROM)).toEqual({
      lists: [
        { id: 'Carpeta/Dentro', name: 'Dentro' },
        { id: 'Surco prueba', name: 'Surco prueba' },
      ],
    })
    expect(snapshotVirtualdjSong(lib.roots(), '/Music/Nowhere.mp3')).toBe('absent')
  })
})

describe('checkVirtualdj', () => {
  it('cannot judge a file whose library read failed before the write, so it never calls it missing', () => {
    const lib = library()
    expect(
      checkVirtualdj(lib.roots(), [
        { from: '/Music/Nowhere.mp3', to: lib.to, before: 'unreadable', size: 8 },
      ]),
    ).toEqual([
      {
        place: 'virtualdj',
        state: 'unreadable',
        detail: { key: 'virtualdjUnreadable' },
        final: true,
      },
    ])
  })

  it('confirms the song and every list that held the source now point at the converted file', async () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), FROM)
    await repointVirtualdjTracks([{ from: FROM, to: lib.to }], lib.deps)
    expect(checkVirtualdj(lib.roots(), [{ from: FROM, to: lib.to, before, size: 8 }])).toEqual([
      {
        place: 'virtualdj',
        state: 'ok',
        detail: { key: 'virtualdjOk', params: { format: 'AIFF' } },
      },
    ])
  })

  it('confirms a file only a list held once that list points at the converted file, with no song to look for', async () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), LISTED)
    await repointVirtualdjTracks([{ from: LISTED, to: lib.to }], lib.deps)
    expect(checkVirtualdj(lib.roots(), [{ from: LISTED, to: lib.to, before, size: 8 }])).toEqual([
      {
        place: 'virtualdj',
        state: 'ok',
        detail: { key: 'virtualdjOk', params: { format: 'AIFF' } },
      },
    ])
  })

  it('names the list still on a file only that list held when its row was not moved', () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), LISTED)
    expect(checkVirtualdj(lib.roots(), [{ from: LISTED, to: lib.to, before, size: 8 }])).toEqual([
      {
        place: 'virtualdj',
        state: 'mismatch',
        detail: { key: 'virtualdjPlaylistMissing', params: { playlist: 'Surco escrita' } },
      },
    ])
  })

  it('says VirtualDJ is still on the source while its song was not moved', () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), FROM)
    expect(checkVirtualdj(lib.roots(), [{ from: FROM, to: lib.to, before, size: 8 }])).toEqual([
      {
        place: 'virtualdj',
        state: 'mismatch',
        detail: { key: 'virtualdjStillOld', params: { format: 'MP3' } },
      },
    ])
  })

  it('names a list whose row stayed on the source when the song moved without its rows', async () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), FROM)
    const dentro = join(lib.dir, 'MyLists', 'Carpeta.subfolders', 'Dentro.vdjfolder')
    const kept = readFileSync(dentro)
    await repointVirtualdjTracks([{ from: FROM, to: lib.to }], lib.deps)
    writeFileSync(dentro, kept)
    expect(checkVirtualdj(lib.roots(), [{ from: FROM, to: lib.to, before, size: 8 }])).toEqual([
      {
        place: 'virtualdj',
        state: 'mismatch',
        detail: { key: 'virtualdjPlaylistMissing', params: { playlist: 'Dentro' } },
      },
    ])
  })

  it('tells a song with another size apart from one that is right, and a song nowhere', async () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), FROM)
    await repointVirtualdjTracks([{ from: FROM, to: lib.to }], lib.deps)
    expect(
      checkVirtualdj(lib.roots(), [
        { from: FROM, to: lib.to, before, size: 9 },
        { from: '/Music/Gone.mp3', to: '/Music/Gone.aiff', before: 'absent', size: 8 },
      ]).map((c) => c.detail.key),
    ).toEqual(['virtualdjSizeDiffers', 'virtualdjMissing'])
  })

  it('checks the lists picked for the converted file and names them when all hold it', async () => {
    const lib = library()
    const before = snapshotVirtualdjSong(lib.roots(), FROM)
    await repointVirtualdjTracks([{ from: FROM, to: lib.to }], lib.deps)
    const wanted = (name: string, id?: string) => [
      { from: FROM, to: lib.to, before, size: 8, playlists: [{ ...(id ? { id } : {}), name }] },
    ]
    expect(checkVirtualdj(lib.roots(), wanted('Dentro', 'Carpeta/Dentro'))).toEqual([
      {
        place: 'virtualdj',
        state: 'ok',
        detail: { key: 'virtualdjOk', params: { format: 'AIFF', playlists: ['Dentro'] } },
      },
    ])
    expect(checkVirtualdj(lib.roots(), wanted('Surco escrita'))[0].detail).toEqual({
      key: 'virtualdjPlaylistMissing',
      params: { playlist: 'Surco escrita' },
    })
  })
})
