import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { CollectionTrack, SourceNode, SourcePlaylistEntry } from '../shared/types'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { seratoRead } from './seratoPlaylistsIpc'

const now = String(Math.floor(Date.now() / 1000))

function library(): SeratoLibraryRoot {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-seratoipc-')), '_Serato_')
  mkdirSync(join(dir, 'Subcrates'), { recursive: true })
  writeFileSync(
    join(dir, 'database V2'),
    concat([
      track({ pfil: 'Music/a.mp3', tadd: now }),
      track({ pfil: 'Music/b.mp3', tadd: '978307200' }),
    ]),
  )
  writeFileSync(
    join(dir, 'Subcrates', 'Friday.crate'),
    concat([
      frame('otrk', frame('ptrk', utf16be('Music/a.mp3'))),
      frame('otrk', frame('ptrk', utf16be('Music/b.mp3'))),
    ]),
  )
  return { dir, root: '/' }
}

describe('seratoRead', () => {
  it('says Serato is there only while a library is found, so the tab shows only where Serato ran', async () => {
    let roots: SeratoLibraryRoot[] = [library()]
    const read = seratoRead({ roots: () => roots })
    expect(read.available()).toBe(true)
    roots = []
    expect(read.available()).toBe(false)
  })

  it('reads the libraries found now, since a drive can be plugged in while Surco runs', async () => {
    let roots: SeratoLibraryRoot[] = []
    const read = seratoRead({ roots: () => roots })
    expect(await read.tree()).toEqual([])
    expect(await read.recentCount()).toBe(0)
    expect(await read.trackCount()).toBe(0)
    roots = [library()]
    expect(((await read.tree()) as SourceNode[]).map((n) => n.name)).toEqual(['Friday'])
    expect(await read.recentCount()).toBe(1)
    expect(await read.trackCount()).toBe(2)
  })

  it('answers which crates hold each file', async () => {
    const roots = [library()]
    const read = seratoRead({ roots: () => roots })
    expect(await read.membership(['/Music/a.mp3'])).toEqual({
      '/Music/a.mp3': ['Friday'],
    })
  })

  it('grants the files of the crate it read, so the rows can play before any disk walk', async () => {
    const roots = [library()]
    const allowMedia = vi.fn()
    const read = seratoRead({ roots: () => roots, allowMedia })
    const entries = (await read.playlist('Friday')) as SourcePlaylistEntry[]
    expect(entries.map((e) => e.path)).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
    expect(allowMedia).toHaveBeenCalledWith(['/Music/a.mp3', '/Music/b.mp3'])
  })

  it('lists the whole collection as rows to match against, read from the libraries found now', async () => {
    let roots: SeratoLibraryRoot[] = []
    const read = seratoRead({ roots: () => roots })
    expect(await read.collection?.()).toEqual([])
    roots = [library()]
    const rows = (await read.collection?.()) as CollectionTrack[]
    expect(rows.map((r) => r.path).sort()).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
  })

  it('grants the files of the collection it read, so Update can retag the library copy the editor found in it', async () => {
    const roots = [library()]
    const allowMedia = vi.fn()
    const read = seratoRead({ roots: () => roots, allowMedia })
    await read.collection?.()
    expect(allowMedia).toHaveBeenCalledWith(
      expect.arrayContaining(['/Music/a.mp3', '/Music/b.mp3']),
    )
  })
})
