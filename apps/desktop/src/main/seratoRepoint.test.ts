import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { crateFileOf } from './seratoCrateFile'
import { parseSeratoCrate, parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import { crateBytes, onlyBackupOf, tempsUnder, twoRoots } from './seratoLibraryFixture'
import { repointSerato } from './seratoRepoint'

vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

const VERSION = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
const databaseOf = (...paths: string[]) =>
  Buffer.from(concat([VERSION, ...paths.map((p) => track({ ttyp: 'mp3', pfil: p, tsng: p }))]))

function library(crates: Parameters<typeof twoRoots>[0] = {}) {
  const lib = twoRoots(crates)
  const [home, gig] = lib.roots
  const homeDb = databaseOf('Users/dj/Music/A.mp3', 'Users/dj/Music/B.mp3')
  const gigDb = databaseOf('Tracks/G.mp3')
  writeFileSync(join(home.dir, 'database V2'), homeDb)
  writeFileSync(join(gig.dir, 'database V2'), gigDb)
  return { ...lib, home, gig, homeDb, gigDb }
}

const pathsIn = (file: string) => parseSeratoDatabase(readFileSync(file)).map((t) => t.path)

describe('repointSerato', () => {
  it('points the Serato track and every crate holding it at the new file, after copying what it rewrites', async () => {
    const lib = library({
      internal: [
        ['Set', ['Users/dj/Music/A.mp3', 'Users/dj/Music/B.mp3']],
        ['Other', ['Users/dj/Music/B.mp3']],
      ],
    })
    const otherBefore = readFileSync(crateFileOf(lib.home, 'Other'))

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: true }])
    expect(pathsIn(join(lib.home.dir, 'database V2'))).toEqual([
      'Users/dj/Music/A.aiff',
      'Users/dj/Music/B.mp3',
    ])
    expect(parseSeratoCrate(readFileSync(crateFileOf(lib.home, 'Set')))).toEqual([
      'Users/dj/Music/A.aiff',
      'Users/dj/Music/B.mp3',
    ])
    expect(readFileSync(crateFileOf(lib.home, 'Other'))).toEqual(otherBefore)
    expect(readFileSync(onlyBackupOf(lib.deps.backupDir, 'Music/database V2'))).toEqual(lib.homeDb)
    expect(readFileSync(onlyBackupOf(lib.deps.backupDir, 'Music/Subcrates/Set.crate'))).toEqual(
      crateBytes(['Users/dj/Music/A.mp3', 'Users/dj/Music/B.mp3']),
    )
    expect(() => onlyBackupOf(lib.deps.backupDir, 'Music/Subcrates/Other.crate')).not.toThrow()
    expect(
      readdirSync(
        join(lib.deps.backupDir, readdirSync(lib.deps.backupDir)[0], 'Music', 'Subcrates'),
      ),
    ).toEqual(['Set.crate'])
  })

  it('writes nothing for a file Serato does not hold', async () => {
    const lib = library()

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/Z.mp3', to: '/Users/dj/Music/Z.aiff', replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: false, reason: 'no-match' }])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(lib.homeDb)
    expect(readdirSync(lib.base)).not.toContain('serato-backups')
  })

  it('waits while Serato is open, since Serato writes its own library over ours when it quits', async () => {
    const lib = library()

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true }],
      { ...lib.deps, seratoOpen: async () => true },
    )

    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(lib.homeDb)
  })

  it('refuses to rewrite a database it could not read to the end', async () => {
    const lib = library()
    const cut = lib.homeDb.subarray(0, lib.homeDb.length - 3)
    writeFileSync(join(lib.home.dir, 'database V2'), cut)

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: false, reason: 'unreadable' }])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(cut)
  })

  it('reads the home library from the disk root, where Serato stores paths without the leading slash', async () => {
    const lib = library()

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/B.mp3', to: '/Users/dj/Music/B.wav', replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: true }])
    expect(pathsIn(join(lib.home.dir, 'database V2'))[1]).toBe('Users/dj/Music/B.wav')
  })

  it("repoints a track on an external drive in that drive's own library", async () => {
    const lib = library({ gig: [['Set', ['Tracks/G.mp3']]] })

    const results = await repointSerato(
      [
        {
          from: join(lib.gig.root, 'Tracks/G.mp3'),
          to: join(lib.gig.root, 'Tracks/G.aiff'),
          replaced: true,
        },
      ],
      lib.deps,
    )

    expect(results).toEqual([{ written: true }])
    expect(pathsIn(join(lib.gig.dir, 'database V2'))).toEqual(['Tracks/G.aiff'])
    expect(parseSeratoCrate(readFileSync(crateFileOf(lib.gig, 'Set')))).toEqual(['Tracks/G.aiff'])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(lib.homeDb)
  })

  it('leaves a track whose new file is on another drive, since one library cannot point across volumes', async () => {
    const lib = library()

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: join(lib.gig.root, 'Tracks/A.aiff'), replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: false, reason: 'other-volume' }])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(lib.homeDb)
    expect(readFileSync(join(lib.gig.dir, 'database V2'))).toEqual(lib.gigDb)
  })

  it('leaves no temp behind after writing', async () => {
    const lib = library({ internal: [['Set', ['Users/dj/Music/A.mp3']]] })

    await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true }],
      lib.deps,
    )

    expect(tempsUnder(lib.base)).toEqual([])
  })

  it('refuses to repoint past a crate it could not read, since that crate may hold the track and would keep a dead path', async () => {
    const lib = library({
      internal: [
        ['Good', ['Users/dj/Music/A.mp3']],
        ['Broken', ['Users/dj/Music/A.mp3']],
      ],
      truncated: ['Broken'],
    })
    const goodBefore = readFileSync(crateFileOf(lib.home, 'Good'))

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true }],
      lib.deps,
    )

    expect(results).toEqual([{ written: false, reason: 'unreadable' }])
    expect(readFileSync(join(lib.home.dir, 'database V2'))).toEqual(lib.homeDb)
    expect(readFileSync(crateFileOf(lib.home, 'Good'))).toEqual(goodBefore)
    expect(readdirSync(lib.base)).not.toContain('serato-backups')
  })

  it('keeps the reasons that waiting cannot fix when Serato is open, so those do not re-queue', async () => {
    const lib = library()

    const results = await repointSerato(
      [
        { from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/A.aiff', replaced: true },
        { from: '/Users/dj/Music/Z.mp3', to: '/Users/dj/Music/Z.aiff', replaced: true },
        { from: '/Users/dj/Music/B.mp3', to: join(lib.gig.root, 'Tracks/B.aiff'), replaced: true },
      ],
      { ...lib.deps, seratoOpen: async () => true },
    )

    expect(results).toEqual([
      { written: false, reason: 'rekordbox-running' },
      { written: false, reason: 'no-match' },
      { written: false, reason: 'other-volume' },
    ])
  })
})
