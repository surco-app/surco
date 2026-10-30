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
import { loadPlaylistCache, savePlaylistCache } from './appleMusicPlaylistCache'

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
