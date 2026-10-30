// @vitest-environment jsdom
import { existsSync } from 'node:fs'
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

// The first time the matrix runs Surco's own pipeline end to end: a FLAC the DJ has in
// rekordbox, Engine and Traktor becomes an AIFF in the output folder, and both the
// independent oracle and the self-check have to agree it came out right.
describe.skipIf(process.platform !== 'darwin')('a matrix batch through the real pipeline', () => {
  it('runs one closed FLAC to AIFF cell green', async () => {
    const cell = CELLS.find((c) => c.id === 'C-flac-aiff')
    if (!cell) throw new Error('no C-flac-aiff cell')
    const [outcome] = await runGroup({ key: cell.id, cells: [cell] })
    expect(existsSync(outcome.finalPath), outcome.finalPath).toBe(true)
    expect(outcome.finalPath.endsWith('.aiff')).toBe(true)
    expect(cellFailure(outcome)).toBeNull()
    expect(outcome.statuses).toEqual(['ok'])
  }, 120_000)
})
