import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSeratoCrate, parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import { repointSerato } from './seratoRepoint'

const VERSION = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
const CRATE_VERSION = frame('vrsn', utf16be('1.0/Serato ScratchLive Crate'))
const crate = (...paths: string[]) =>
  concat([CRATE_VERSION, ...paths.map((p) => frame('otrk', frame('ptrk', utf16be(p))))])

function library() {
  const root = mkdtempSync(join(tmpdir(), 'serato-root-'))
  const dir = join(root, '_Serato_')
  mkdirSync(join(dir, 'Subcrates'), { recursive: true })
  const database = concat([
    VERSION,
    track({ ttyp: 'mp3', pfil: 'Music/A.mp3', tsng: 'A' }),
    track({ ttyp: 'wave', pfil: 'Music/B.wav', tsng: 'B' }),
  ])
  writeFileSync(join(dir, 'database V2'), database)
  writeFileSync(join(dir, 'Subcrates', 'Set.crate'), crate('Music/A.mp3', 'Music/B.wav'))
  writeFileSync(join(dir, 'Subcrates', 'Other.crate'), crate('Music/B.wav'))
  const backupDir = mkdtempSync(join(tmpdir(), 'serato-backup-'))
  return { root, dir, database, backupDir }
}

const closed = async () => false

describe('repointSerato', () => {
  it('points the Serato track and every crate holding it at the renamed file, after copying what it rewrites', async () => {
    const { root, dir, database, backupDir } = library()
    const otherCrate = readFileSync(join(dir, 'Subcrates', 'Other.crate'))

    const results = await repointSerato(
      [{ from: join(root, 'Music/A.mp3'), to: join(root, 'Music/Artist - A.mp3') }],
      { roots: () => [{ dir, root }], backupDir, seratoOpen: closed },
    )

    expect(results).toEqual([{ written: true }])
    expect(parseSeratoDatabase(readFileSync(join(dir, 'database V2'))).map((t) => t.path)).toEqual([
      'Music/Artist - A.mp3',
      'Music/B.wav',
    ])
    expect(parseSeratoCrate(readFileSync(join(dir, 'Subcrates', 'Set.crate')))).toEqual([
      'Music/Artist - A.mp3',
      'Music/B.wav',
    ])
    expect(readFileSync(join(dir, 'Subcrates', 'Other.crate'))).toEqual(otherCrate)
    const [stamp] = readdirSync(backupDir)
    expect(readFileSync(join(backupDir, stamp, 'database V2'))).toEqual(Buffer.from(database))
    expect(readdirSync(join(backupDir, stamp, 'Subcrates'))).toEqual(['Set.crate'])
  })

  it('writes nothing for a file Serato does not hold', async () => {
    const { root, dir, database, backupDir } = library()

    const results = await repointSerato(
      [{ from: join(root, 'Music/C.mp3'), to: join(root, 'Music/D.mp3') }],
      { roots: () => [{ dir, root }], backupDir, seratoOpen: closed },
    )

    expect(results).toEqual([{ written: false, reason: 'no-match' }])
    expect(readFileSync(join(dir, 'database V2'))).toEqual(Buffer.from(database))
    expect(readdirSync(backupDir)).toEqual([])
  })

  it('waits while Serato is open, since Serato writes its own library over ours when it quits', async () => {
    const { root, dir, database, backupDir } = library()

    const results = await repointSerato(
      [{ from: join(root, 'Music/A.mp3'), to: join(root, 'Music/Artist - A.mp3') }],
      { roots: () => [{ dir, root }], backupDir, seratoOpen: async () => true },
    )

    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
    expect(readFileSync(join(dir, 'database V2'))).toEqual(Buffer.from(database))
  })

  it('refuses to rewrite a database it could not read to the end', async () => {
    const { root, dir, database, backupDir } = library()
    const cut = database.subarray(0, database.length - 3)
    writeFileSync(join(dir, 'database V2'), cut)

    const results = await repointSerato(
      [{ from: join(root, 'Music/A.mp3'), to: join(root, 'Music/Artist - A.mp3') }],
      { roots: () => [{ dir, root }], backupDir, seratoOpen: closed },
    )

    expect(results).toEqual([{ written: false, reason: 'unreadable' }])
    expect(readFileSync(join(dir, 'database V2'))).toEqual(Buffer.from(cut))
  })

  it('reads the home library from the disk root, where Serato stores paths without the leading slash', async () => {
    const { dir, backupDir } = library()
    writeFileSync(
      join(dir, 'database V2'),
      concat([VERSION, track({ ttyp: 'mp3', pfil: 'Users/dj/Music/A.mp3' })]),
    )

    const results = await repointSerato(
      [{ from: '/Users/dj/Music/A.mp3', to: '/Users/dj/Music/B.mp3' }],
      { roots: () => [{ dir, root: '/' }], backupDir, seratoOpen: closed },
    )

    expect(results).toEqual([{ written: true }])
    expect(parseSeratoDatabase(readFileSync(join(dir, 'database V2')))[0].path).toBe(
      'Users/dj/Music/B.mp3',
    )
  })
})
