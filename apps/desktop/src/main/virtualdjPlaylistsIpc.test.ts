import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ALL_TRACKS_ID } from '../shared/allTracks'
import type { CollectionTrack, SourceNode, SourcePlaylistEntry } from '../shared/types'
import { virtualdjRead } from './virtualdjPlaylistsIpc'

const fixture = join(__dirname, 'virtualdjFixtures')

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-vdjipc-')), 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  return dir
}

describe('virtualdjRead', () => {
  it('says VirtualDJ is there only while its database is, so the tab shows only where VirtualDJ ran', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    expect(read.available()).toBe(true)
    rmSync(join(dir, 'database.xml'))
    expect(read.available()).toBe(false)
  })

  it('says VirtualDJ is not there on Windows, where nothing of it is measured yet', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      expect(read.available()).toBe(false)
    } finally {
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })

  it('reads the folder Settings names now, since the DJ can point Surco elsewhere while it runs', () => {
    let dir = join(tmpdir(), 'surco-vdjipc-nowhere')
    const read = virtualdjRead({ dir: () => dir })
    expect(read.available()).toBe(false)
    expect(read.tree()).toEqual([])
    expect(read.trackCount()).toBe(0)
    dir = copy()
    expect(read.available()).toBe(true)
    expect((read.tree() as SourceNode[]).map((n) => n.name)).toEqual([
      'Carpeta',
      'Surco prueba',
      'Surco escrita',
    ])
    expect(read.trackCount()).toBe(6)
  })

  it('counts as recently added what VirtualDJ first saw in the last 30 days', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    vi.useFakeTimers({ now: new Date(2026, 11, 1) })
    expect(read.recentCount()).toBe(6)
    vi.setSystemTime(new Date(2027, 1, 1))
    expect(read.recentCount()).toBe(0)
    vi.useRealTimers()
  })

  it('grants the files of the list it read, so the rows can play before any disk walk', () => {
    const dir = copy()
    const allowMedia = vi.fn()
    const read = virtualdjRead({ dir: () => dir, allowMedia })
    const entries = read.playlist('Carpeta/Dentro') as SourcePlaylistEntry[]
    expect(entries.map((e) => e.contentId)).toEqual(['virtualdj:/Music/Serato Pruebas/Pray.mp3'])
    expect(allowMedia).toHaveBeenCalledWith(['/Music/Serato Pruebas/Pray.mp3'])
  })

  it('opens All tracks with every song of the database', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    expect((read.playlist(ALL_TRACKS_ID) as SourcePlaylistEntry[]).length).toBe(6)
  })

  it('answers which lists hold each file', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    expect(read.membership(['/Music/VirtualDJ Pruebas/Pray.flac'])).toEqual({
      '/Music/VirtualDJ Pruebas/Pray.flac': ['Surco escrita'],
    })
  })

  it('lists the whole collection as rows to match a pasted tracklist against', () => {
    const dir = copy()
    const read = virtualdjRead({ dir: () => dir })
    const rows = read.collection?.() as CollectionTrack[]
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.contentId === `virtualdj:${r.path}`)).toBe(true)
  })
})
