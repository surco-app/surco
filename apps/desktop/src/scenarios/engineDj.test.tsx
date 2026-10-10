// @vitest-environment jsdom
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { buildEngineDatabase, loadSqlJs } from '../main/engine'
import { coverJpg, listFiles, makeTrack } from './fixtures'
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

describe('Take your tracks to Engine DJ', () => {
  let library: string
  let output: string
  let mdb: string
  let before: Buffer
  let surco: Scenario

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'surco-engine-'))
    library = join(root, 'Engine Library')
    output = join(root, 'Surco')
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
    makeTrack(join(crate, 'b.wav'), { title: 'Higher State', artist: 'Josh Wink' })
    surco = await openSurco({
      settings: { outputDir: output, engineLibraryDir: library },
      destination: 'engineDj',
    })
    await surco.drop(crate)
    surco.editMeta('a.flac', { rating: '4' })
    await surco.convertAll()
  }, 60_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('backs up the library as it was before writing to it', () => {
    expect(readFileSync(`${mdb}.surco-backup`).equals(before)).toBe(true)
  })

  it('puts every track in the library and in the playlist, next to what was there', async () => {
    const titles = await query(mdb, 'SELECT title FROM Track ORDER BY title')
    expect(titles.flat()).toEqual(['Already There', 'Higher State', 'Plastic Dreams'])
    const inPlaylist = await query(
      mdb,
      "SELECT t.title FROM PlaylistEntity e JOIN Track t ON t.id = e.trackId JOIN Playlist p ON p.id = e.listId WHERE p.title = 'Surco' ORDER BY t.title",
    )
    expect(inPlaylist.flat()).toEqual(['Already There', 'Higher State', 'Plastic Dreams'])
  })

  it('brings the rating and the cover', async () => {
    const [[rating, art]] = await query(
      mdb,
      "SELECT t.rating, length(a.albumArt) FROM Track t LEFT JOIN AlbumArt a ON a.id = t.albumArtId WHERE t.title = 'Plastic Dreams'",
    )
    expect(rating).toBe(80)
    expect(art).toBeGreaterThan(1000)
  })

  it('points Engine at files that exist in the output folder', async () => {
    expect(listFiles(output)).toEqual(['a.aiff', 'b.aiff'])
    const paths = await query(mdb, "SELECT path FROM Track WHERE title != 'Already There'")
    for (const [path] of paths) expect(existsSync(join(library, String(path))), String(path)).toBe(true)
  })
})
