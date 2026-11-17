import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import {
  readSeratoLibrary,
  type SeratoLibraryRoot,
  seratoMembership,
  seratoPlaylist,
  seratoTree,
} from './seratoLibrary'
import { runSeratoRead, type SeratoReadName } from './seratoReads'
import { runWorkerJob } from './workerJobs'

function library(): SeratoLibraryRoot {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-seratoreads-')), '_Serato_')
  mkdirSync(join(dir, 'Subcrates'), { recursive: true })
  writeFileSync(
    join(dir, 'database V2'),
    concat([
      track({ pfil: 'Music/a.mp3', tadd: '978307200' }),
      track({ pfil: 'Music/b.mp3', tadd: '978307200' }),
    ]),
  )
  writeFileSync(
    join(dir, 'Subcrates', 'Friday.crate'),
    concat([frame('otrk', frame('ptrk', utf16be('Music/a.mp3')))]),
  )
  return { dir, root: '/' }
}

describe('runSeratoRead', () => {
  it('reads the tree, a crate and its membership as the main process did, so moving the read to a thread changes nothing the DJ sees', () => {
    const roots = [library()]
    const direct = readSeratoLibrary(roots)
    expect(runSeratoRead(roots, 'tree', undefined)).toEqual(seratoTree(direct))
    expect(runSeratoRead(roots, 'playlist', 'Friday')).toEqual(seratoPlaylist(direct, 'Friday'))
    expect(runSeratoRead(roots, 'membership', ['/Music/a.mp3', '/Music/b.mp3'])).toEqual(
      seratoMembership(direct, ['/Music/a.mp3', '/Music/b.mp3']),
    )
    expect(runSeratoRead(roots, 'membership', ['/Music/a.mp3'])).toEqual({
      '/Music/a.mp3': ['Friday'],
    })
  })

  it('answers every read with plain data, since the answer has to cross from the thread to the main process', async () => {
    const roots = [library()]
    const reads: [SeratoReadName, unknown][] = [
      ['tree', undefined],
      ['recentCount', undefined],
      ['trackCount', undefined],
      ['collection', undefined],
      ['playlist', 'Friday'],
      ['membership', ['/Music/a.mp3']],
    ]
    for (const [name, arg] of reads) {
      const answer = runSeratoRead(roots, name, arg as never)
      expect(structuredClone(answer), name).toEqual(answer)
    }
    expect(
      await runWorkerJob({ type: 'seratoRead', roots, name: 'trackCount', arg: undefined }),
    ).toBe(2)
  })
})
