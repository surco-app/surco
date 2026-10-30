// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { analysedTrack } from '../main/enginePerformanceFixture'
import { writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import { openRekordboxDb } from '../main/rekordboxDb'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Sabotage } from './harness'
import { makeRekordbox } from './rekordboxFixture'

async function convertInBothLibraries(
  name: string,
  sabotage?: (db: string, source: string) => Sabotage,
) {
  const root = scenarioDir(name)
  const source = makeTrack(join(root, 'Crate', 'x.flac'), {
    title: 'Plastic Dreams',
    artist: 'Jaydee',
    signal: 'kick',
  })
  const rekordboxDbPath = makeRekordbox(join(root, 'rekordbox'), [
    {
      id: '900001',
      path: source,
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      fileType: 5,
      cuesMs: [2000],
    },
  ])
  const engineLibraryDir = join(root, 'Engine Library')
  writeEngineLibraryFixture(engineLibraryDir, {
    tracks: [{ id: 1, path: relative(engineLibraryDir, source), title: 'Plastic Dreams' }],
    playlists: [],
    entities: [],
    performance: [analysedTrack(1)],
  }).close()
  const surco = await openSurco({
    verify: true,
    sabotage: sabotage?.(rekordboxDbPath, source),
    settings: {
      outputFormat: 'aiff',
      outputDir: join(root, 'Surco'),
      syncRekordbox: true,
      rekordboxDbPath,
      syncEngineDj: true,
      engineLibraryDir,
    },
    destination: 'folder',
  })
  await surco.drop(join(root, 'Crate'))
  await surco.convertAll()
  await surco.settled()
  return surco
}

describe('The self-check reads back what each library ended up pointing at', () => {
  it('says ok for a FLAC converted to AIFF once rekordbox and Engine point at it', async () => {
    const surco = await convertInBothLibraries('verify-ok')
    const v = surco.verification('x.flac')
    expect(v?.status).toBe('ok')
    expect(v?.checks.map((c) => [c.place, c.state])).toEqual([
      ['file', 'ok'],
      ['rekordbox', 'ok'],
      ['engine', 'ok'],
    ])
    expect(surco.statuses('x.flac')).toEqual(['ok'])
    expect(surco.errors).toEqual([])
  }, 60_000)

  it('says mismatch when rekordbox was put back on the old file before it was read', async () => {
    const surco = await convertInBothLibraries('verify-rollback', (db, source) => ({
      beforeLibraryCheck: () => {
        const opened = openRekordboxDb(db)
        opened
          ?.prepare(
            `UPDATE djmdContent SET FolderPath = ?, FileNameL = 'x.flac', FileType = 5 WHERE ID = '900001'`,
          )
          .run(source)
        opened?.close()
      },
    }))
    const v = surco.verification('x.flac')
    expect(v?.status).toBe('mismatch')
    expect(v?.checks.find((c) => c.place === 'rekordbox')?.detail.key).toBe('rekordboxStillOld')
  }, 60_000)

  it('says the file is wrong when its audio was damaged after the conversion wrote it', async () => {
    const surco = await convertInBothLibraries('verify-damaged', () => ({
      afterConvert: (finalPath) => {
        const bytes = readFileSync(finalPath)
        bytes.fill(0x55, Math.floor(bytes.length * 0.6), Math.floor(bytes.length * 0.6) + 4096)
        writeFileSync(finalPath, bytes)
      },
    }))
    const file = surco.verification('x.flac')?.checks.find((c) => c.place === 'file')
    expect(file?.state).toBe('mismatch')
    expect(file?.detail.key).toBe('filePcmDiffers')
  }, 60_000)
})
