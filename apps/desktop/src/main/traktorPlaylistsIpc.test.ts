import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CollectionTrack, SourceNode, SourcePlaylistEntry } from '../shared/types'
import { traktorCoverUrl } from './traktorCoverCache'
import { traktorRead } from './traktorPlaylistsIpc'

const today = new Date()
const imported = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY TITLE="A"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="${imported}"></INFO></ENTRY>
<ENTRY TITLE="B"><LOCATION DIR="/:Music/:" FILE="b.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="2001/1/1"></INFO></ENTRY>
</COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="Friday"><PLAYLIST ENTRIES="2" TYPE="LIST" UUID="u1">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:a.mp3"></PRIMARYKEY></ENTRY>
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:b.mp3"></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`

async function collection(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'surco-traktoripc-')), 'collection.nml')
  await writeFile(file, NML)
  return file
}

describe('traktorRead', () => {
  it('says Traktor is there only while a collection is found, so the tab shows only where Traktor is installed', async () => {
    let found = await collection()
    const read = traktorRead(() => found, { bootVolume: () => 'HD' })
    expect(read.available()).toBe(true)
    found = ''
    expect(read.available()).toBe(false)
  })

  it('reads the collection found now, since the DJ can change it in Settings while Surco runs', async () => {
    const file = await collection()
    let found = ''
    const read = traktorRead(() => found, { bootVolume: () => 'HD' })
    expect(read.tree()).toEqual([])
    expect(read.recentCount()).toBe(0)
    found = file
    expect((read.tree() as SourceNode[]).map((n) => n.name)).toEqual(['Friday'])
    expect(read.recentCount()).toBe(1)
  })

  it('answers which playlists hold each file, and nothing without a collection, so the field can fill in', async () => {
    const file = await collection()
    let found = ''
    const read = traktorRead(() => found, { bootVolume: () => 'HD' })
    expect(read.membership(['/Music/a.mp3'])).toEqual({})
    found = file
    expect(read.membership(['/Music/a.mp3'])).toEqual({ '/Music/a.mp3': ['u1'] })
  })

  it('points a row at the thumbnail Traktor keeps beside the collection, so its file needs only the light read', async () => {
    const file = await collection()
    await writeFile(
      file,
      NML.replace(
        `<INFO IMPORT_DATE="${imported}">`,
        `<INFO IMPORT_DATE="${imported}" COVERARTID="042/ABC">`,
      ),
    )
    const cache = join(file, '..', 'Coverart', '042')
    await mkdir(cache, { recursive: true })
    await writeFile(join(cache, 'ABC000'), 'thumb')
    const read = traktorRead(() => file, { bootVolume: () => 'HD' })

    const entries = read.playlist('u1') as SourcePlaylistEntry[]

    expect(entries.map((e) => e.preview?.coverUrl)).toEqual([traktorCoverUrl('042/ABC'), undefined])
  })

  it('fails on a collection it cannot read, so the tab says so instead of showing no playlists', async () => {
    const read = traktorRead(() => '/nowhere/collection.nml', { bootVolume: () => 'HD' })
    expect(() => read.tree()).toThrow()
  })

  it('grants the files of the playlist it read, so the rows can play before any disk walk', async () => {
    const file = await collection()
    const allowMedia = vi.fn()
    const read = traktorRead(() => file, { bootVolume: () => 'HD', allowMedia })
    const entries = read.playlist('u1') as SourcePlaylistEntry[]
    expect(entries.map((e) => e.path)).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
    expect(allowMedia).toHaveBeenCalledWith(['/Music/a.mp3', '/Music/b.mp3'])
  })

  it('lists the whole collection as rows to match against, and nothing without a collection', async () => {
    const file = await collection()
    let found = ''
    const read = traktorRead(() => found, { bootVolume: () => 'HD' })
    expect(read.collection?.()).toEqual([])
    found = file
    const rows = read.collection?.() as CollectionTrack[]
    expect(rows.map((r) => r.path).sort()).toEqual(['/Music/a.mp3', '/Music/b.mp3'])
  })
})
