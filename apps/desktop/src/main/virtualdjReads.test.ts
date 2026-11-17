import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_TRACKS_ID } from '../shared/allTracks'
import {
  readVirtualdjLibrary,
  virtualdjLibraryRoots,
  virtualdjMembership,
  virtualdjPlaylist,
  virtualdjTree,
} from './virtualdjLibrary'
import { runVirtualdjRead, type VirtualdjReadName } from './virtualdjReads'
import { runWorkerJob } from './workerJobs'

function roots() {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-vdjreads-')), 'VirtualDJ')
  cpSync(join(__dirname, 'virtualdjFixtures'), dir, { recursive: true })
  return virtualdjLibraryRoots(dir, mkdtempSync(join(tmpdir(), 'surco-vdjreads-volumes-')))
}

const FILE = '/Music/VirtualDJ Pruebas/Pray.flac'

describe('runVirtualdjRead', () => {
  it('reads the tree, a list and its membership as the main process did, so moving the read to a thread changes nothing the DJ sees', () => {
    const at = roots()
    const direct = readVirtualdjLibrary(at)
    expect(runVirtualdjRead(at, 'tree', undefined)).toEqual(virtualdjTree(direct))
    expect(runVirtualdjRead(at, 'playlist', ALL_TRACKS_ID)).toEqual(
      virtualdjPlaylist(direct, ALL_TRACKS_ID),
    )
    expect(runVirtualdjRead(at, 'membership', [FILE])).toEqual(virtualdjMembership(direct, [FILE]))
    expect(runVirtualdjRead(at, 'trackCount', undefined)).toBe(6)
  })

  it('answers every read with plain data, since the answer has to cross from the thread to the main process', async () => {
    const at = roots()
    const reads: [VirtualdjReadName, unknown][] = [
      ['tree', undefined],
      ['recentCount', undefined],
      ['trackCount', undefined],
      ['collection', undefined],
      ['playlist', ALL_TRACKS_ID],
      ['membership', [FILE]],
    ]
    for (const [name, arg] of reads) {
      const answer = runVirtualdjRead(at, name, arg as never)
      expect(structuredClone(answer), name).toEqual(answer)
    }
    expect(
      await runWorkerJob({ type: 'virtualdjRead', roots: at, name: 'trackCount', arg: undefined }),
    ).toBe(6)
  })
})
