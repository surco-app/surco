import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-amplaylists-'))
  return { app: { getPath: () => dir } }
})

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicPlaylistTracks } from '../shared/types'
import {
  derivedPlaylistCache,
  loadPlaylistCache,
  loadPlaylistListCache,
  savePlaylistCache,
  savePlaylistListCache,
  savePlaylistMembers,
} from './appleMusicPlaylistCache'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

const tracks: AppleMusicPlaylistTracks = {
  paths: ['/m/a.wav'],
  persistentIds: { '/m/a.wav': 'A1B2C3D4E5F60718' },
  meta: { '/m/a.wav': { grouping: 'Bases' } },
  missing: 1,
  total: 2,
}

describe('appleMusicPlaylistCache', () => {
  it('returns null for a playlist never read', () => {
    expect(loadPlaylistCache('0000000000000001')).toBeNull()
  })

  // Reading a 2,044-track playlist from a NAS took 0.3 s one time and 14 s the next; the
  // last whole read is what lets it open at once, every count already right.
  it('gives back the last whole read of a playlist', () => {
    savePlaylistCache('A1B2C3D4E5F60718', tracks)
    expect(loadPlaylistCache('A1B2C3D4E5F60718')).toEqual(tracks)
  })

  // The ID arrives from the renderer and names a file: anything but Music's 16 hex digits
  // could write or read outside the cache folder.
  it('neither writes nor reads a name that is not a persistent ID', () => {
    savePlaylistCache('../escape', tracks)
    expect(existsSync(join(app.getPath('userData'), 'escape.json'))).toBe(false)
    expect(loadPlaylistCache('../escape')).toBeNull()
  })

  it('returns null for a file that is not a playlist read', () => {
    const dir = join(app.getPath('userData'), 'apple-music-playlists')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'FFEEDDCCBBAA9988.json'), '{"paths": "nope"}')
    expect(loadPlaylistCache('FFEEDDCCBBAA9988')).toBeNull()
    writeFileSync(join(dir, 'FFEEDDCCBBAA9988.json'), '{"paths": [')
    expect(loadPlaylistCache('FFEEDDCCBBAA9988')).toBeNull()
  })
})

// Listing the playlists took 1.8 s (measured 01/11); the list kept from last time lets the
// Music tab show its tree at once while Music lists them again.
describe('the playlist list', () => {
  it('gives back the last list Music gave', () => {
    const lists = [{ persistentId: 'A1B2C3D4E5F60718', name: 'Friday', count: 450 }]
    savePlaylistListCache(lists)
    expect(loadPlaylistListCache()).toEqual(lists)
  })

  it('gives nothing back for a list that is not one', () => {
    const file = join(app.getPath('userData'), 'apple-music-playlists', 'list.json')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '{"not":"a list"}')
    expect(loadPlaylistListCache()).toBeNull()
  })
})

// A playlist opened for the first time had nothing to show until Music resolved each of its
// files on the NAS: 2.5-4 s of an empty column while another playlist was loading (measured
// 04/11). Which tracks it holds is cheap to know; the rest is already in the library's read.
describe('a playlist never read whole', () => {
  const LIBRARY = 'AAAAAAAAAAAAAAA1'
  const library: AppleMusicPlaylistTracks = {
    paths: ['/m/a.wav', '/m/b.wav', '/m/c.wav'],
    persistentIds: {
      '/m/a.wav': '000000000000000A',
      '/m/b.wav': '000000000000000B',
      '/m/c.wav': '000000000000000C',
    },
    meta: { '/m/a.wav': { grouping: 'Bases' }, '/m/c.wav': { year: '1999' } },
    missing: 0,
    total: 3,
  }

  function withLibrary(): void {
    savePlaylistListCache([{ persistentId: LIBRARY, name: 'Music', count: 3, library: true }])
    savePlaylistCache(LIBRARY, library)
  }

  it('is built from the tracks it holds, in its own order, out of the library read', () => {
    withLibrary()
    savePlaylistMembers({ BBBBBBBBBBBBBBB2: ['000000000000000C', '000000000000000A'] })

    expect(derivedPlaylistCache('BBBBBBBBBBBBBBB2')).toEqual({
      paths: ['/m/c.wav', '/m/a.wav'],
      persistentIds: { '/m/c.wav': '000000000000000C', '/m/a.wav': '000000000000000A' },
      meta: { '/m/c.wav': { year: '1999' }, '/m/a.wav': { grouping: 'Bases' } },
      missing: 0,
      total: 2,
    })
  })

  // A streaming row has no file in the library read; it is counted, as a whole read counts it,
  // so the "22 of 24" the column shows is right from the first paint.
  it('counts a track the library read holds no file for as missing', () => {
    withLibrary()
    savePlaylistMembers({ BBBBBBBBBBBBBBB2: ['000000000000000B', 'FFFFFFFFFFFFFFFF'] })

    expect(derivedPlaylistCache('BBBBBBBBBBBBBBB2')).toMatchObject({
      paths: ['/m/b.wav'],
      missing: 1,
      total: 2,
    })
  })

  it('is nothing when the membership or the library read is not known', () => {
    savePlaylistMembers({})
    expect(derivedPlaylistCache('CCCCCCCCCCCCCCC3')).toBeNull()
  })
})
