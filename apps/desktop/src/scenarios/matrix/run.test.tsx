// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())
vi.mock('../../main/applemusic', async (original) => ({
  ...(await import('../fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../../main/appleMusicPlaylists', async () =>
  (await import('../fakeMusic')).playlistsModule(),
)
vi.mock('../../main/appleMusicArtwork', async (original) =>
  (await import('../fakeMusic')).artworkModule(await original()),
)
vi.mock('../../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('../../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => false) }))

import { CELLS } from './cells'
import { cellFailure } from './report'
import { runGroup } from './run'

describe.skipIf(process.platform !== 'darwin')('a matrix batch through the real pipeline', () => {
  // Same format with another extension is rewritten in place: the .aif becomes an .aiff in
  // its own folder and the .aif goes to Surco's Originals, which is no loss.
  it('runs an AIF made into an AIFF in its own folder green', async () => {
    const cell = CELLS.find((c) => c.id === 'C-aif-aiff')
    if (!cell) throw new Error('no C-aif-aiff cell')
    const [outcome] = await runGroup({ key: cell.id, cells: [cell] })
    expect(cellFailure(outcome)).toBeNull()
  }, 120_000)

  // With MP3 sources kept, the MP3 is left as it is: no AIFF, and every program still
  // plays the MP3 with its cues where they were.
  it('runs the cell that keeps MP3 sources green', async () => {
    const cell = CELLS.find((c) => c.id === 'K13')
    if (!cell) throw new Error('no K13 cell')
    const [outcome] = await runGroup({ key: cell.id, cells: [cell] })
    expect(outcome.finalPath.endsWith('.mp3')).toBe(true)
    expect(cellFailure(outcome)).toBeNull()
  }, 120_000)
})
