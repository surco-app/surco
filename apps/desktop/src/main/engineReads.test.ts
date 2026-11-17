import { mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { engineContentId } from '../shared/engineContent'
import { readEngineTrackCues } from './engineCues'
import { openEngineDb, readEnginePlaylist, readEngineTree } from './enginePlaylists'
import { engineDbPath, writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { type EngineReadName, emptyEngineRead, runEngineRead } from './engineReads'
import { runWorkerJob } from './workerJobs'

async function library(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginereads-'))
  writeEngineLibraryFixture(dir, {
    tracks: [
      { id: 1, path: '../Music/a.mp3', title: 'A' },
      { id: 2, path: '../Music/b.mp3', title: 'B' },
    ],
    playlists: [
      { id: 7, title: 'Friday', parentListId: 0, nextListId: 8 },
      { id: 8, title: 'Warmup', parentListId: 0, nextListId: 0 },
    ],
    entities: [
      { id: 1, listId: 7, trackId: 1, nextEntityId: 2 },
      { id: 2, listId: 7, trackId: 2, nextEntityId: 0 },
      { id: 3, listId: 8, trackId: 1, nextEntityId: 0 },
    ],
  }).close()
  return dir
}

describe('runEngineRead', () => {
  it('reads the tree and a playlist as the main process did, so moving the read to a thread changes nothing the DJ sees', async () => {
    const dir = await library()
    const art = join(dir, 'art')
    const db = openEngineDb(dir)
    if (!db) throw new Error('did not open')
    const tree = readEngineTree(db)
    const playlist = readEnginePlaylist(db, dir, '7', art)
    db.close()
    expect(runEngineRead(dir, 'tree', undefined)).toEqual(tree)
    expect(runEngineRead(dir, 'playlist', { id: '7', artDir: art })).toEqual(playlist)
    expect(playlist).toHaveLength(2)
  })

  it('answers every read with plain data, since the answer has to cross from the thread to the main process', async () => {
    const dir = await library()
    const reads: [EngineReadName, unknown][] = [
      ['tree', undefined],
      ['recentCount', undefined],
      ['trackCount', undefined],
      ['playlist', { id: '7', artDir: join(dir, 'art') }],
      ['membership', [resolve(dir, '../Music/a.mp3')]],
    ]
    for (const [name, arg] of reads) {
      const answer = runEngineRead(dir, name, arg as never)
      expect(structuredClone(answer), name).toEqual(answer)
    }
  })

  it('names every list holding a file and sees a list changed after, so the kept read never hides what the DJ just did', async () => {
    const dir = await library()
    const a = resolve(dir, '../Music/a.mp3')
    const b = resolve(dir, '../Music/b.mp3')
    expect(runEngineRead(dir, 'membership', [a, b, resolve(dir, '../Music/z.mp3')])).toEqual({
      [a]: ['7', '8'],
      [b]: ['7'],
    })
    const db = new Database(engineDbPath(dir))
    db.prepare('DELETE FROM PlaylistEntity WHERE listId = 8').run()
    db.close()
    await utimes(engineDbPath(dir), new Date(), new Date(Date.now() + 5000))
    expect(runEngineRead(dir, 'membership', [a])).toEqual({ [a]: ['7'] })
  })

  it('hands the cues of a whole selection and of one track from the thread, since clearing thousands of tracks one database open at a time froze the app for minutes', async () => {
    const dir = await library()
    const ids = [engineContentId(1), engineContentId(2), engineContentId(99)]
    const db = openEngineDb(dir)
    if (!db) throw new Error('did not open')
    const one = readEngineTrackCues(db, ids[0])
    db.close()
    const live = runEngineRead(dir, 'liveCues', ids)
    expect(Object.keys(live)).toEqual(ids.slice(0, 2))
    expect(live[ids[0]]).toEqual({ cues: one?.cues, fingerprint: one?.fingerprint })
    expect(runEngineRead(dir, 'trackCues', ids[0])).toEqual(one)
    expect(runEngineRead(dir, 'trackCues', ids[2])).toBeNull()
    expect(runEngineRead(dir, 'file', ids[0])).toBe(resolve(dir, '../Music/a.mp3'))
    expect(runEngineRead(dir, 'file', ids[2])).toBeNull()
  })

  it('answers the empty read without a library, the normal case for a DJ who does not use Engine DJ', () => {
    expect(emptyEngineRead('tree')).toEqual([])
    expect(emptyEngineRead('membership')).toEqual({})
    expect(emptyEngineRead('trackCount')).toBe(0)
  })
})

describe('the engineRead worker job', () => {
  it('runs the read it names, so the thread and the inline fallback answer alike', async () => {
    const dir = await library()
    expect(
      await runWorkerJob({ type: 'engineRead', dir, name: 'trackCount', arg: undefined }),
    ).toBe(2)
  })
})
