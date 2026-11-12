import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOT_KINDS } from '../shared/cueRules'
import { traktorContentId } from '../shared/traktorContent'
import { REKORDBOX_BEAT_AFTER_RISE_MS } from './beatGrid'
import { automaticCueOffsetMs, mp3TimingOfFile } from './cueCalibration'
import { traktorTrackCuesOf } from './traktorCues'
import { withTraktorCues } from './traktorCuesWrite'

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

describe('traktorCueSource on a LAME MP3', () => {
  const LEAD_MS = ((1152 + 576 + 529) / 44100) * 1000
  const SURCO_MS = 10000
  const GRID_MS = 151.18

  const lameMp3 = async (): Promise<string> => {
    const file = join(dir, 'lame.mp3')
    execFileSync(ffmpegStatic as unknown as string, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      file,
    ])
    const bytes = await readFile(file)
    bytes.write('LAME', bytes.indexOf('Lavc'), 'latin1')
    await writeFile(file, bytes)
    return file
  }

  const traktorDir = (path: string) =>
    `${path
      .split('/')
      .filter(Boolean)
      .map((part) => `/:${part}`)
      .join('')}/:`

  const lameSource = async () => {
    const file = await lameMp3()
    const key = `Macintosh HD${traktorDir(dir)}lame.mp3`
    await writeFile(
      nmlPath,
      collection(
        `<ENTRY TITLE="lame"><LOCATION DIR="${traktorDir(dir)}" FILE="lame.mp3" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION>\n<INFO PLAYTIME="1" PLAYTIME_FLOAT="1.000000"></INFO>\n<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>\n<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${GRID_MS}" LEN="0.000000" REPEATS="-1" HOTCUE="0"><GRID BPM="120.000000"></GRID></CUE_V2>\n</ENTRY>`,
      ),
    )
    const cues = traktorCueSource(
      {
        nml: () => nmlPath,
        bootVolume: () => 'Macintosh HD',
        queue: { cuesOp: vi.fn(), drop: vi.fn(), enqueue: vi.fn() },
        applyQuietly: vi.fn(),
        words: async () => new Uint16Array([7]),
        fine: async () => new Uint8Array([1]),
      },
      () => '',
      async () => ({ bpm: 120, firstMs: 100 }),
    )
    return { file, cues, id: traktorContentId(key) }
  }

  it('draws the wave, the fine wave, the audition and the grid where Traktor draws this MP3, 51.18 ms after Surco’s clock', async () => {
    const { cues, id } = await lameSource()
    expect((await cues.trackCues(id))?.clockLeadMs).toBeCloseTo(LEAD_MS, 6)
    expect(await cues.auditionLead(id)).toBeCloseTo(LEAD_MS, 6)
    expect((await cues.fineWave(id))?.startMs).toBeCloseTo(LEAD_MS, 6)
    expect((await cues.gridFit(id, 'high'))?.firstMs).toBeCloseTo(
      100 + LEAD_MS + REKORDBOX_BEAT_AFTER_RISE_MS,
      6,
    )
    const words = (await cues.waveDetail(id)) as Uint16Array
    expect(words.indexOf(7)).toBe(Math.round((LEAD_MS * 150) / 1000))
  })

  it('runs Auto mark on Surco’s words moved by the same 51.18 ms, once, against Traktor’s own grid', async () => {
    const { cues, id } = await lameSource()
    const input = await cues.dropInput(id)
    expect(input?.words.indexOf(7)).toBe(Math.round((LEAD_MS * 150) / 1000))
    expect(input?.grid[0]?.ms).toBeCloseTo(GRID_MS, 6)
  })

  it('stores a cue placed at 10000 ms on Surco’s wave at 10051.18 ms in Traktor, which the conversion to WAV carries back to 10000', async () => {
    const { file, cues, id } = await lameSource()
    const placed = SURCO_MS + (await cues.auditionLead(id))
    const block = await readFile(nmlPath, 'utf8')
    const saved = withTraktorCues(block, [{ ms: placed, kind: HOT_KINDS[0], color: null }])
    const stored = traktorTrackCuesOf(saved, id).cues[0]?.ms ?? 0
    expect(stored).toBeCloseTo(10051.18, 2)
    expect(stored + automaticCueOffsetMs(await mp3TimingOfFile(file), null)).toBeCloseTo(
      SURCO_MS,
      3,
    )
  })
})
