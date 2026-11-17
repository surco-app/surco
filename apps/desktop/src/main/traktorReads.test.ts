import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { traktorContentId } from '../shared/traktorContent'
import { readTraktorPlaylist, readTraktorTree } from './traktorPlaylists'
import { emptyTraktorRead, runTraktorRead, type TraktorReadName } from './traktorReads'
import { runWorkerJob } from './workerJobs'

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY TITLE="A"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="2001/1/1"></INFO></ENTRY>
<ENTRY TITLE="B"><LOCATION DIR="/:Music/:" FILE="b.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO IMPORT_DATE="2001/1/1"></INFO></ENTRY>
</COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="Friday"><PLAYLIST ENTRIES="2" TYPE="LIST" UUID="u1">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:a.mp3"></PRIMARYKEY></ENTRY>
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:b.mp3"></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`

async function collection(text = NML): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'surco-traktorreads-')), 'collection.nml')
  await writeFile(file, text)
  return file
}

describe('runTraktorRead', () => {
  it('reads the tree and a playlist as the main process did, so moving the read to a thread changes nothing the DJ sees', async () => {
    const file = await collection()
    expect(runTraktorRead(file, 'HD', 'tree', undefined)).toEqual(readTraktorTree(NML))
    const rows = runTraktorRead(file, 'HD', 'playlist', 'u1')
    expect(rows.map((r) => r.path)).toEqual(readTraktorPlaylist(NML, 'u1', 'HD').map((r) => r.path))
    expect(rows).toHaveLength(2)
  })

  it('answers every read with plain data, since the answer has to cross from the thread to the main process', async () => {
    const file = await collection()
    const reads: [TraktorReadName, unknown][] = [
      ['tree', undefined],
      ['recentCount', undefined],
      ['trackCount', undefined],
      ['collection', undefined],
      ['playlist', 'u1'],
      ['membership', ['/Music/a.mp3']],
      ['playedTogether', ['u1']],
    ]
    for (const [name, arg] of reads) {
      const answer = runTraktorRead(file, 'HD', name, arg as never)
      expect(structuredClone(answer), name).toEqual(answer)
    }
  })

  it('says which playlists hold a file and sees a collection saved after, so the kept read never hides what the DJ just did', async () => {
    const file = await collection()
    expect(runTraktorRead(file, 'HD', 'membership', ['/Music/a.mp3'])).toEqual({
      '/Music/a.mp3': ['u1'],
    })
    await writeFile(
      file,
      NML.replace(
        '<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:Music/:a.mp3"></PRIMARYKEY></ENTRY>\n',
        '',
      ),
    )
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    expect(runTraktorRead(file, 'HD', 'membership', ['/Music/a.mp3'])).toEqual({
      '/Music/a.mp3': [],
    })
  })

  it('says whether the collection holds a file and which track it is, so a file Traktor still plays is never retired and its cues reach the same track', async () => {
    const file = await collection()
    expect(runTraktorRead(file, 'HD', 'holdsFile', { path: '/Music/a.mp3', resolve: false })).toBe(
      true,
    )
    expect(runTraktorRead(file, 'HD', 'holdsFile', { path: '/Music/z.mp3', resolve: false })).toBe(
      false,
    )
    expect(
      runTraktorRead(file, 'HD', 'trackOf', { dir: '/:Music/:', file: 'a.mp3', volume: 'HD' }),
    ).toBe(traktorContentId('HD/:Music/:a.mp3'))
    expect(
      runTraktorRead(file, 'HD', 'trackOf', { dir: '/:Music/:', file: 'z.mp3', volume: 'HD' }),
    ).toBeUndefined()
    expect(runTraktorRead(file, 'HD', 'hasSeparator', undefined)).toBe(false)
  })

  it('answers the empty read without a collection, the normal case for a DJ who does not use Traktor', () => {
    expect(emptyTraktorRead('tree')).toEqual([])
    expect(emptyTraktorRead('membership')).toEqual({})
    expect(emptyTraktorRead('trackCount')).toBe(0)
  })

  it('fails on a collection it cannot read, so the tab says so instead of showing no playlists', () => {
    expect(() => runTraktorRead('/nowhere/collection.nml', 'HD', 'tree', undefined)).toThrow()
  })
})

describe('the traktorRead worker job', () => {
  it('runs the read it names, so the thread and the inline fallback answer alike', async () => {
    const file = await collection()
    expect(
      await runWorkerJob({
        type: 'traktorRead',
        file,
        bootVolume: 'HD',
        name: 'trackCount',
        arg: undefined,
      }),
    ).toBe(2)
  })
})
