import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylistWithPreview, readRekordboxTree } from './rekordboxPlaylists'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { emptyRekordboxRead, type RekordboxReadName, runRekordboxRead } from './rekordboxReads'
import { runWorkerJob } from './workerJobs'

async function collection(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbreads-')), 'master.db')
  writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
  return path
}

const FILE = '/Volumes/Public/Music/Night Train.aiff'

describe('runRekordboxRead', () => {
  it('reads the tree and a playlist as the main process did, so moving the read to a thread changes nothing the DJ sees', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const tree = readRekordboxTree(db)
    const playlist = readRekordboxPlaylistWithPreview(db, join(path, '..', 'share'), '2000')
    db.close()
    expect(runRekordboxRead(path, undefined, 'tree', undefined)).toEqual(tree)
    expect(runRekordboxRead(path, undefined, 'playlist', '2000')).toEqual(playlist)
    expect(playlist.length).toBeGreaterThan(0)
  })

  it('answers every read with plain data, since the answer has to cross from the thread to the main process', async () => {
    const path = await collection()
    const reads: [RekordboxReadName, unknown][] = [
      ['tree', undefined],
      ['recentCount', undefined],
      ['trackCount', undefined],
      ['collection', undefined],
      ['matching', undefined],
      ['playedTogether', ['2000']],
      ['playlist', '2000'],
      ['hasSeparator', undefined],
      ['membership', [FILE]],
      ['marked', undefined],
    ]
    for (const [name, arg] of reads) {
      const answer = runRekordboxRead(path, undefined, name, arg as never)
      expect(structuredClone(answer), name).toEqual(answer)
    }
  })

  it('says which playlists hold a file and sees a change written after, so the kept read never hides what the DJ just did', async () => {
    const path = await collection()
    expect(runRekordboxRead(path, undefined, 'membership', [FILE])).toEqual({ [FILE]: ['2000'] })
    const db = openRekordboxDb(path)
    if (!db) throw new Error('did not open')
    db.prepare('UPDATE djmdSongPlaylist SET rb_local_deleted = 1 WHERE PlaylistID = ?').run('2000')
    db.close()
    expect(runRekordboxRead(path, undefined, 'membership', [FILE])).toEqual({ [FILE]: [] })
  })

  it('answers the empty read without a collection, the normal case for a DJ who does not use rekordbox', () => {
    expect(emptyRekordboxRead('tree')).toEqual([])
    expect(emptyRekordboxRead('membership')).toEqual({})
    expect(emptyRekordboxRead('marked')).toBe(0)
    expect(emptyRekordboxRead('hasSeparator')).toBe(false)
  })

  it('fails on a collection that is there but does not read, so the list says it could not read instead of showing no playlists', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbreads-')), 'master.db')
    expect(() => runRekordboxRead(path, undefined, 'tree', undefined)).toThrow()
  })
})

describe('the rekordboxRead worker job', () => {
  it('runs the read it names, so the thread and the inline fallback answer alike', async () => {
    const path = await collection()
    expect(
      await runWorkerJob({ type: 'rekordboxRead', path, name: 'trackCount', arg: undefined }),
    ).toBe(runRekordboxRead(path, undefined, 'trackCount', undefined))
  })
})
