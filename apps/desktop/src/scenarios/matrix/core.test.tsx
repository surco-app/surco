// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

import { CELLS, groupsOf } from './cells'
import { type CellOutcome, cellFailure, writeReport } from './report'
import { runGroup } from './run'

// The core runs with every test run so a conversion that breaks a DJ's library, or a
// self-check that says ok over a broken result, turns the normal suite red the same day.
describe.skipIf(process.platform !== 'darwin')('Matriz de resultados (núcleo)', () => {
  const outcomes: CellOutcome[] = []

  afterAll(() => {
    if (outcomes.length > 0) writeReport(outcomes)
  })

  for (const group of groupsOf(CELLS.filter((c) => c.core))) {
    describe(group.key, () => {
      const byId = new Map<string, CellOutcome>()

      beforeAll(async () => {
        for (const outcome of await runGroup(group)) {
          byId.set(outcome.cell.id, outcome)
          outcomes.push(outcome)
        }
      }, 120_000)

      for (const cell of group.cells) {
        it(cell.name, () => {
          const outcome = byId.get(cell.id)
          if (!outcome) throw new Error(`sin resultado para ${cell.id}`)
          expect(cellFailure(outcome)).toBeNull()
        })
      }
    })
  }
})
