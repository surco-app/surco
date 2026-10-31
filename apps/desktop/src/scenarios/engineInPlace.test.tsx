// @vitest-environment jsdom
import { readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { loadSqlJs } from '../main/engine'
import { analysedTrack } from '../main/enginePerformanceFixture'
import { engineDbPath, writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import type { NormalizeConfig, Settings } from '../shared/types'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco } from './harness'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

async function engineRow(library: string) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(engineDbPath(library)))
  try {
    const [[path, fileBytes]] = db.exec('SELECT path, fileBytes FROM Track')[0].values
    return { path, fileBytes }
  } finally {
    db.close()
  }
}

// A record Engine DJ already has, rewritten over itself as the only track of the run.
async function rewriteInPlace(
  name: string,
  options: { settings?: Partial<Settings>; storedBytes?: (size: number) => number },
) {
  const root = scenarioDir(name)
  const source = join(root, 'Crate', 'Record.flac')
  const library = join(root, 'Engine Library')
  makeTrack(source, { title: 'Record', artist: 'A', signal: 'kick' })
  const db = writeEngineLibraryFixture(library, {
    tracks: [{ id: 1, path: relative(library, source) }],
    playlists: [],
    entities: [],
    performance: [analysedTrack(1)],
  })
  const size = statSync(source).size
  db.prepare("UPDATE Track SET fileType = 'flac', fileBytes = ? WHERE id = 1").run(
    options.storedBytes?.(size) ?? size,
  )
  db.close()
  const surco = await openSurco({
    settings: {
      outputFormat: 'source',
      engineLibraryDir: library,
      syncEngineDj: true,
      ...options.settings,
    },
    destination: 'overwrite',
  })
  await surco.drop(join(root, 'Crate'))
  return { surco, source, library, size }
}

// Updating the tags rewrites the file on its own path. Engine's row keeps the path, cues and
// playlists, but it describes the file by its size too.
describe('Update the tags of a record Engine DJ already has, over itself', () => {
  let run: Awaited<ReturnType<typeof rewriteInPlace>>

  beforeAll(async () => {
    run = await rewriteInPlace('engine-retag-in-place', {})
    run.surco.editMeta('Record.flac', { title: 'Record (A Much Longer Extended Club Mix)' })
    await run.surco.convertAll()
  }, 90_000)

  it('runs without a single error the user would see', () => {
    expect(run.surco.errors).toEqual([])
  })

  it('records the rewritten file’s size on the same row', async () => {
    expect(statSync(run.source).size).not.toBe(run.size)
    expect(await engineRow(run.library)).toEqual({
      path: relative(run.library, run.source),
      fileBytes: statSync(run.source).size,
    })
  })
})

describe('Normalize a record Engine DJ already has, over itself', () => {
  let run: Awaited<ReturnType<typeof rewriteInPlace>>

  beforeAll(async () => {
    run = await rewriteInPlace('engine-normalize-in-place', {
      settings: { normalize: STREAMING },
    })
    await run.surco.convertAll()
  }, 90_000)

  it('records the normalized file’s size on the same row', async () => {
    expect(statSync(run.source).size).not.toBe(run.size)
    expect((await engineRow(run.library)).fileBytes).toBe(statSync(run.source).size)
  })
})

// A row that already recorded some other size is not one the write can tell it owes this
// rewrite, so a retry or a queued apply never writes over what another write left.
describe('Rewrite over itself a record whose Engine DJ row has another size', () => {
  let run: Awaited<ReturnType<typeof rewriteInPlace>>

  beforeAll(async () => {
    run = await rewriteInPlace('engine-stale-size-in-place', {
      settings: { normalize: STREAMING },
      storedBytes: (size) => size - 1,
    })
    await run.surco.convertAll()
  }, 90_000)

  it('leaves the row’s size as it was', async () => {
    expect((await engineRow(run.library)).fileBytes).toBe(run.size - 1)
  })
})
