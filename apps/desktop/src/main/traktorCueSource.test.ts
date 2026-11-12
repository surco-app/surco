import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { traktorContentId } from '../shared/traktorContent'

const reads = vi.hoisted(() => ({ count: 0, scans: 0 }))

vi.mock('./traktorNml', async (importOriginal) => {
  const real = await importOriginal<typeof import('./traktorNml')>()
  return {
    ...real,
    findEntries: (...args: Parameters<typeof real.findEntries>) => {
      reads.scans += 1
      return real.findEntries(...args)
    },
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    readFileSync: (...args: Parameters<typeof real.readFileSync>) => {
      reads.count += 1
      return real.readFileSync(...args)
    },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: (...args: Parameters<typeof real.readFile>) => {
      reads.count += 1
      return real.readFile(...args)
    },
  }
})

const { traktorCueSource } = await import('./traktorCueSource')

const keyOf = (file: string) => `Macintosh HD/:Users/:dj/:Music/:${file}`

const entry = (file: string, startMs: number) =>
  `<ENTRY TITLE="${file}"><LOCATION DIR="/:Users/:dj/:Music/:" FILE="${file}" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION>\n<INFO PLAYTIME="240" PLAYTIME_FLOAT="240.000000"></INFO>\n<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="${startMs}" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>\n</ENTRY>`

const collection = (...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="${entries.length}">\n${entries.join('\n')}\n</COLLECTION></NML>`

const FILES = ['a.flac', 'b.flac', 'c.flac', 'd.flac', 'e.flac']

let dir: string
let nmlPath: string

const source = () =>
  traktorCueSource(
    {
      nml: () => nmlPath,
      bootVolume: () => 'Macintosh HD',
      queue: { cuesOp: vi.fn(), drop: vi.fn(), enqueue: vi.fn() },
      applyQuietly: vi.fn(),
      words: async () => null,
    },
    () => '',
    async () => null,
  )

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'surco-traktor-source-'))
  nmlPath = join(dir, 'collection.nml')
  await writeFile(nmlPath, collection(...FILES.map((f) => entry(f, 1000))))
  reads.count = 0
  reads.scans = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('traktorCueSource', () => {
  it('reads an unchanged collection once however many tracks are asked about, because the bad-grid filter asks about every track in the list and a big collection.nml is tens of MB', async () => {
    const cues = source()
    for (const file of FILES) {
      await cues.trackCues(traktorContentId(keyOf(file)))
    }
    expect(reads.count).toBe(1)
  })

  it('walks an unchanged collection once however many tracks are asked about, because finding each track by walking every entry made the bad-grid filter take a minute on a 10,000-track collection', async () => {
    const cues = source()
    for (const file of FILES) {
      await cues.trackCues(traktorContentId(keyOf(file)))
    }
    expect(reads.scans).toBe(1)
  })

  it('answers a track listed twice from its first entry, the one Surco has always read', async () => {
    await writeFile(nmlPath, collection(entry('a.flac', 1000), entry('a.flac', 7000)))
    expect((await source().trackCues(traktorContentId(keyOf('a.flac'))))?.cues[0]?.ms).toBe(1000)
  })

  it('answers from the collection as it is now once Traktor or Surco rewrites it, so a cue just saved never shows its old position', async () => {
    const cues = source()
    const id = traktorContentId(keyOf('a.flac'))
    expect((await cues.trackCues(id))?.cues[0]?.ms).toBe(1000)
    await writeFile(
      nmlPath,
      collection(entry('a.flac', 2500), ...FILES.slice(1).map((f) => entry(f, 1000))),
    )
    const later = new Date(Date.now() + 60_000)
    await utimes(nmlPath, later, later)
    expect((await cues.trackCues(id))?.cues[0]?.ms).toBe(2500)
  })

  it('has nothing to say about a track when no collection is set', async () => {
    nmlPath = ''
    expect(await source().trackCues(traktorContentId(keyOf('a.flac')))).toBeNull()
  })
})
