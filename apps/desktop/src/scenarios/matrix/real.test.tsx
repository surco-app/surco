// @vitest-environment jsdom
import { appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
vi.mock('../../main/virtualdjProcess', () => ({
  isVirtualdjRunning: vi.fn(async () => false),
  waitForVirtualdjExit: vi.fn(async () => true),
}))

import { CELLS, type Cell, type CellGroup, groupsOf } from './cells'
import { type LibrarySet, type SeededTrack, seedMusic, syncedPrograms } from './libraries'
import {
  assertOriginalsUntouched,
  copyRealLibraries,
  correlationLagMs,
  createRunRoot,
  pristine,
  type RealCopy,
  realSourcesFromEnv,
  removeRunRoot,
  type Watched,
  watchSources,
} from './realLibraries'
import { type CellOutcome, cellFailure, writeReport } from './report'
import { runFixture, startMusic, witnessesOf } from './run'

const held = (t: SeededTrack, cell: Cell): boolean =>
  syncedPrograms(cell.programs).every(
    (p) =>
      (p === 'rekordbox' && t.rekordboxId) ||
      (p === 'engine' && t.engineId) ||
      (p === 'traktor' && t.traktorAudioId) ||
      p === 'music',
  )

function sampledFor(group: CellGroup, tracks: SeededTrack[]): [Cell, SeededTrack][] {
  const used = new Set<SeededTrack>()
  return group.cells.flatMap((cell): [Cell, SeededTrack][] => {
    const free = tracks.filter((t) => t.origin === cell.origin && !used.has(t))
    const t = free.find((x) => held(x, cell)) ?? free[0]
    if (!t) return []
    used.add(t)
    return [[cell, t]]
  })
}

function groupSet(copy: RealCopy, first: Cell, tracks: SeededTrack[]): LibrarySet {
  const synced = new Set(syncedPrograms(first.programs))
  const fresh = (t: SeededTrack): SeededTrack => ({
    ...t,
    musicPid: undefined,
    playlists: { ...t.playlists, music: [] },
  })
  const set: LibrarySet = {
    ...copy.set,
    tracks: tracks.map(fresh),
    bystander: fresh(copy.set.bystander),
    music: first.programs === 'music',
    settings: {
      ...copy.set.settings,
      syncRekordbox: synced.has('rekordbox') && !!copy.set.rekordboxDb,
      syncEngineDj: synced.has('engine') && !!copy.set.engineDir,
      syncTraktor: synced.has('traktor') && !!copy.set.traktorNml,
    },
  }
  if (set.music) {
    const lists = seedMusic([...set.tracks, set.bystander])
    for (const t of [...set.tracks, set.bystander]) t.playlists = { ...t.playlists, music: lists }
  }
  return set
}

// Opt-in, by hand before a release: the conversion cells over copies of the DJ's own
// rekordbox, Engine and Traktor collections and of a sample of their files. The originals are
// only ever opened read-only to copy them, and their bytes and dates are checked after the
// run before anything else is reported.
describe.skipIf(process.env.SURCO_MATRIX_REAL !== '1')(
  'Matriz de resultados (copias reales)',
  () => {
    const outcomes: CellOutcome[] = []
    let root = ''
    let copy: RealCopy | undefined
    const watched: Watched[] = []
    let restore: () => void = () => {}

    beforeAll(async () => {
      const sources = realSourcesFromEnv()
      watchSources(sources, watched)
      root = createRunRoot(
        process.env.SURCO_MATRIX_ROOT || process.env.SURCO_SYSTEM_TMPDIR || tmpdir(),
      )
      copy = await copyRealLibraries(sources, root, undefined, watched)
      restore = pristine(copy)
    }, 3_600_000)

    afterAll(() => {
      let touched: unknown
      try {
        assertOriginalsUntouched({ originals: watched })
      } catch (e) {
        touched = e
      }
      try {
        if (outcomes.length > 0 && copy) {
          const path = writeReport(outcomes)
          appendFileSync(
            path,
            ['## Preparación de las copias', '', ...copy.rewrites.map((r) => `- ${r}`), ''].join(
              '\n',
            ),
          )
        }
      } finally {
        if (root && process.env.SURCO_MATRIX_KEEP !== '1') removeRunRoot(root)
      }
      if (touched) throw touched
    }, 600_000)

    for (const group of groupsOf(CELLS.filter((c) => c.layer === 'C' || c.layer === 'D'))) {
      describe(group.key, () => {
        const byId = new Map<string, CellOutcome>()

        beforeAll(async () => {
          if (!copy) throw new Error('las colecciones no se copiaron')
          const picked = sampledFor(group, copy.set.tracks)
          if (picked.length === 0) return
          const cells = picked.map(([cell]) => cell)
          restore()
          rmSync(join(root, 'Salida'), { recursive: true, force: true })
          rmSync(join(root, 'Testigo'), { recursive: true, force: true })
          startMusic(cells[0], root)
          const set = groupSet(
            copy,
            cells[0],
            picked.map(([, t]) => t),
          )
          const fixture = {
            root,
            sources: set.tracks,
            witnesses: witnessesOf(root, set.tracks),
            set,
          }
          for (const outcome of await runFixture({ key: group.key, cells }, fixture, {
            lagMs: correlationLagMs,
          })) {
            byId.set(outcome.cell.id, outcome)
            outcomes.push(outcome)
          }
        }, 1_800_000)

        for (const cell of group.cells) {
          it(cell.name, (ctx) => {
            const outcome = byId.get(cell.id)
            if (!outcome)
              return ctx.skip(
                `las colecciones no tienen una pista ${cell.origin} con cues y playlists`,
              )
            expect(cellFailure(outcome)).toBeNull()
          })
        }
      })
    }
  },
)
