// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => true) }))

import { buildEngineDatabase, loadSqlJs } from '../main/engine'
import { isEngineDjRunning } from '../main/engineProcess'
import { coverJpg, makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

async function query(db: string, sql: string): Promise<unknown[][]> {
  const SQL = await loadSqlJs()
  const opened = new SQL.Database(readFileSync(db))
  try {
    return opened.exec(sql)[0]?.values ?? []
  } finally {
    opened.close()
  }
}

describe('Convert into Engine DJ while Engine DJ is open', () => {
  let library: string
  let mdb: string
  let before: Buffer
  let surco: Scenario

  beforeAll(async () => {
    const root = scenarioDir('engine-open')
    library = join(root, 'Engine Library')
    mdb = join(library, 'Database2', 'm.db')
    mkdirSync(join(library, 'Database2'), { recursive: true })
    before = Buffer.from(
      await buildEngineDatabase(
        [
          {
            relativePath: '../Old/kept.mp3',
            filename: 'kept.mp3',
            fileType: 'mp3',
            fileBytes: 1,
            title: 'Already There',
            artist: 'Someone',
            album: '',
            genre: '',
            comment: '',
            bpm: 120,
            bpmAnalyzed: 120,
            year: null,
            durationSec: 300,
            rating: 0,
          },
        ],
        'Surco',
      ),
    )
    writeFileSync(mdb, before)

    const crate = join(root, 'Crate')
    makeTrack(join(crate, 'a.flac'), {
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      coverJpg: coverJpg(join(root, 'cover.jpg')),
    })
    surco = await openSurco({
      settings: { outputDir: join(root, 'Surco'), engineLibraryDir: library, addToEngineDj: true },
    })
    await surco.drop(crate)
    await surco.convertAll()
  }, 60_000)

  it('finishes the conversion without asking to close Engine or failing the track', () => {
    expect(surco.errors).toEqual([])
    expect(surco.summary()?.failed ?? 0).toBe(0)
  })

  it('leaves the library untouched while Engine is open, since Engine would write its own copy back over it', () => {
    expect(readFileSync(mdb).equals(before)).toBe(true)
  })

  it('keeps the track in the Engine queue, so the DJ sees it is still to be added', () => {
    expect(surco.engineQueue().items).toEqual([
      expect.objectContaining({ parts: expect.arrayContaining([{ kind: 'collection' }]) }),
    ])
  })

  it('adds the track with its cover once Engine closes', async () => {
    vi.mocked(isEngineDjRunning).mockResolvedValue(false)
    await surco.engineClosed()
    expect(surco.engineQueue().tracks).toBe(0)
    const rows = await query(
      mdb,
      "SELECT length(a.albumArt) FROM Track t JOIN AlbumArt a ON a.id = t.albumArtId WHERE t.title = 'Plastic Dreams'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0][0]).toBeGreaterThan(1000)
  })
})
