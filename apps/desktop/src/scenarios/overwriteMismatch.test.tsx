// @vitest-environment jsdom
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/verifyFile', async (original) => ({
  ...(await original<typeof import('../main/verifyFile')>()),
  checkFile: async () => ({
    place: 'file',
    state: 'mismatch',
    detail: { key: 'fileTagDiffers', params: { field: 'genre' } },
  }),
}))

import { selectionStatus } from '../renderer/src/lib/selectionStatus'
import { supersededFile } from '../renderer/src/lib/supersededFile'
import { scenarioRoot } from './electronFake'
import { listFiles, makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

// Converting over the original to another format leaves the old file behind under its own
// extension. With the default setting it goes into Surco's Originals, which is the way back
// when the self-check finds the new file wrong: so a mismatch must keep it there, never
// send it to the system Trash nor offer it for deletion.
describe('A FLAC converted to MP3 over the original that the self-check finds wrong', () => {
  let folder: string
  let source: string
  let surco: Scenario

  beforeAll(async () => {
    folder = scenarioDir('overwrite-mismatch')
    source = makeTrack(join(folder, 'tune.flac'), { title: 'Tune', artist: 'Someone' })
    surco = await openSurco({ settings: { outputFormat: 'mp3' }, destination: 'overwrite' })
    await surco.drop(source)
    await surco.convertAll('confirm', 'mp3')
  }, 60_000)

  it('finishes with the mismatch on the track', () => {
    const [track] = surco.tracks()
    expect(track.status).toBe('done')
    expect(track.verification?.status).toBe('mismatch')
  })

  it('keeps the original in Surco Originals, not in the system Trash', async () => {
    expect(listFiles(folder)).toEqual(['tune.mp3'])
    expect((await surco.trash.list()).map((e) => e.originalPath)).toEqual([source])
    const osTrash = join(scenarioRoot, 'home', 'Trash')
    expect(existsSync(osTrash) ? readdirSync(osTrash) : []).toEqual([])
  })

  it('offers nothing to delete, as the row now has one file for source and output', () => {
    const [track] = surco.tracks()
    expect(supersededFile(track)).toBeNull()
    expect(selectionStatus(track, undefined, true).canDeleteOriginal).toBe(false)
  })

  it('can put the original back on its path', async () => {
    const [entry] = await surco.trash.list()
    await surco.trash.restore(entry.id)
    expect(existsSync(source)).toBe(true)
  })
})
