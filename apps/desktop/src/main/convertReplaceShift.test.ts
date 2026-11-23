import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const watch = vi.hoisted(() => ({
  onDecode: undefined as
    | ((args: string[], child: { exitCode: number | null; signalCode: string | null }) => void)
    | undefined,
  traktorCueOffsetMs: 0,
}))

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({
  getSettings: () => ({
    syncTraktor: true,
    traktorNmlPath: '/x.nml',
    traktorCueOffsetMs: watch.traktorCueOffsetMs,
  }),
}))
vi.mock('./rekordboxBatch', () => ({ recordRekordboxRepoint: vi.fn() }))
vi.mock('./nmlBatch', () => ({ recordNmlPatch: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const promised = (real.execFile as unknown as Record<symbol, (...a: unknown[]) => unknown>)[
    promisify.custom
  ]
  const execFile = Object.assign(
    (...a: unknown[]) => (real.execFile as unknown as (...b: unknown[]) => unknown)(...a),
    {
      [promisify.custom]: (...a: unknown[]) => {
        const pending = promised(...a) as { child: never }
        watch.onDecode?.(a[1] as string[], pending.child)
        return pending
      },
    },
  )
  return { ...real, default: { ...real, execFile }, execFile }
})

import { withSeratoCues } from '../shared/seratoMarkers'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { recordNmlPatch } from './nmlBatch'
import { recordRekordboxRepoint } from './rekordboxBatch'
import { seratoLeadOfFile } from './seratoClock'
import { readSeratoTrack, setSeratoMarkers } from './seratoTags'

// A replacement is a new master of a track the DJ already prepared: every cue, loop and grid
// they set lives on the old file's audio. If the new master starts later or earlier, each
// program has to move those cues by exactly that much or they land off the beat in the booth.
// The shift is measured once in the conversion and handed to rekordbox, Engine DJ, VirtualDJ,
// Traktor and Serato in their own units and signs.
const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-convert-replace-shift-'))
const SECONDS = 200

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function music(path: string, seed: number, rate = 44100): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:seed=${seed}:d=${SECONDS}:r=${rate}:a=0.3`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='if(lt(mod(t,0.437),0.002),0.8,0)':s=${rate}:d=${SECONDS}`,
    '-filter_complex',
    'amix=inputs=2:normalize=0',
    '-ac',
    '2',
    path,
  ])
}

function derive(from: string, to: string, args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', '-i', from, ...args, to])
}

// ffmpeg writes the LAME tag a LAME download carries, encoder delay included, but signs it
// "Lavc"; re-signed, rekordboxTimeline.ts reads the 51.18 ms lead a Soulseek MP3 has.
function lameMp3(from: string, path: string): void {
  derive(from, path, ['-c:a', 'libmp3lame', '-b:a', '320k'])
  const bytes = readFileSync(path)
  const at = bytes.indexOf('Lavc', 0, 'latin1')
  bytes.write('LAME', at, 'latin1')
  writeFileSync(path, bytes)
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const repoint = () => vi.mocked(recordRekordboxRepoint).mock.calls.at(-1)?.[0]
const patch = () => vi.mocked(recordNmlPatch).mock.calls.at(-1)?.[0]

let oldWav: string
let later: string
let other: string
let other48: string
let n = 0

function fresh(name: string): string {
  const sub = join(dir, `case-${++n}`)
  mkdirSync(sub)
  return join(sub, name)
}

function replace(
  input: string,
  output: string,
  replacesPath: string | undefined,
  extra: {
    trim?: { startSec: number }
    isCancelled?: () => boolean
    onTmp?: (p: string) => void
  } = {},
) {
  return convertAudio(
    input,
    output,
    'aiff',
    meta,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    extra.onTmp,
    undefined,
    undefined,
    extra.trim,
    undefined,
    undefined,
    replacesPath,
    extra.isCancelled,
  )
}

const near = (actual: number | undefined, expected: number) =>
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(1)

beforeAll(() => {
  oldWav = join(dir, 'old.wav')
  later = join(dir, 'later.flac')
  other = join(dir, 'other.flac')
  other48 = join(dir, 'other48.flac')
  music(oldWav, 11)
  derive(oldWav, later, ['-af', 'adelay=1500:all=1'])
  music(other, 23)
  music(other48, 23, 48000)
})

beforeEach(() => {
  vi.mocked(recordRekordboxRepoint).mockClear()
  vi.mocked(recordNmlPatch).mockClear()
  watch.traktorCueOffsetMs = 0
  watch.onDecode = undefined
})

describe('a replacement measured in the conversion', () => {
  // The new master has 1.5 s more lead-in: every beat sounds 1.5 s later, so every program
  // must carry the DJ's cues 1.5 s later too, each in its own sign.
  it('shifts every program by 1.5 s when the new master starts 1.5 s later', async () => {
    const { written } = await replace(later, fresh('Song.aiff'), oldWav)

    near((written.replaceShift as { moved: number }).moved, 1500)
    expect(repoint()?.replaced).toBe(true)
    near(repoint()?.audio?.cueShiftMs, 1500)
    near(repoint()?.engineShift?.trimmedMs, -1500)
    expect(repoint()?.engineShift?.sampleRateHz).toBe(44100)
    near(patch()?.cueShift?.shiftMs, -1500)
  }, 120_000)

  // rekordbox places a LAME MP3's first sample 51 ms into its timeline and an AIFF's at 0:
  // cues set on the MP3 have to lose that lead or they sit 51 ms after their kick.
  it("adds rekordbox's lead of the old LAME MP3", async () => {
    const oldMp3 = fresh('old.mp3')
    lameMp3(oldWav, oldMp3)

    await replace(later, fresh('Song.aiff'), oldMp3)

    near(repoint()?.audio?.cueShiftMs, 1449)
  }, 120_000)

  // The lossless master of the LAME MP3 the DJ prepared: the same audio, so ffmpeg measures
  // no shift, but rekordbox placed the MP3 51 ms into its timeline and the AIFF at 0. A cue
  // set on the kick at 10 000 ms has to land at 9 949 ms, or every pad fires 51 ms late.
  it("takes the old LAME MP3's rekordbox lead off a replacement that moved nothing", async () => {
    const oldMp3 = fresh('old.mp3')
    lameMp3(oldWav, oldMp3)
    const same = fresh('same.flac')
    derive(oldWav, same, [])

    const { written } = await replace(same, fresh('Song.aiff'), oldMp3)

    near((written.replaceShift as { moved: number }).moved, 0)
    near(10000 + (repoint()?.audio?.cueShiftMs ?? Number.NaN), 9949)
  }, 120_000)

  // The DJ's own Traktor offset is applied to every conversion; a replacement that moves the
  // cues is no exception, or the DJ's calibration is lost on exactly the tracks they swap.
  it("applies the DJ's Traktor offset on a moved replacement", async () => {
    watch.traktorCueOffsetMs = -51

    await replace(later, fresh('Song.aiff'), oldWav)

    near(patch()?.cueShift?.shiftMs, -1449)
  }, 120_000)

  // Traktor's codec offset is a property of the file the DJ's cues were set on: it has to be
  // read from the replaced MP3 against the new file, not from the download, or every cue on a
  // swapped MP3 lands off its kick by the MP3's decoder delay (51.18 ms that ffmpeg skips on
  // a LAME MP3 and Traktor does not).
  it("takes Traktor's codec offset from the replaced MP3, not from the download", async () => {
    watch.traktorCueOffsetMs = -10
    const oldMp3 = fresh('old.mp3')
    lameMp3(oldWav, oldMp3)

    await replace(later, fresh('Song.aiff'), oldMp3)

    expect(patch()?.cueShift?.shiftMs).toBeCloseTo(-1500 + 51.18 + 10, 1)
  }, 120_000)

  // Another recording has no shift to measure: moving the cues to the best fit of noise would
  // scatter them, so nothing moves and the measure says why. The FLAC's samples reach the AIFF
  // untouched, so rekordbox gets no cue move at all and keeps its analysis.
  it('moves nothing and says why when the new file is another recording', async () => {
    const { written } = await replace(other, fresh('Song.aiff'), oldWav)

    expect(written.replaceShift).toEqual({ unmoved: 'noMatch' })
    expect(repoint()?.audio).toBeUndefined()
    expect(repoint()?.engineShift?.trimmedMs).toBe(0)
    expect(patch()?.cueShift).toBeUndefined()
  }, 120_000)

  // Engine DJ keeps cues in samples: a 48 kHz file read with 44.1 kHz positions puts every cue
  // 8.8 % early, so the new rate travels even when the shift could not be measured.
  it('rescales Engine DJ to a 48 kHz replacement it could not measure', async () => {
    await replace(other48, fresh('Song.aiff'), oldWav)

    expect(repoint()?.engineShift).toEqual({ trimmedMs: 0, sampleRateHz: 48000 })
  }, 120_000)

  // When the new file lands on the old file's path, the rename destroys the old audio: measured
  // after it, the conversion would compare the new file with itself and never move a cue.
  it('measures before the rename when the new file takes the replaced path', async () => {
    const oldAiff = fresh('Song.aiff')
    derive(oldWav, oldAiff, [])
    const bytes = statSync(oldAiff).size

    const { written } = await replace(later, oldAiff, oldAiff)

    near((written.replaceShift as { moved: number }).moved, 1500)
    expect(repoint()).toMatchObject({ from: oldAiff, to: oldAiff, fromBytes: bytes })
  }, 120_000)

  // A replaced file that is gone cannot be measured, but the DJ asked for the new file and
  // still gets it: a measurement never costs a conversion.
  it('finishes the conversion when the old file cannot be read', async () => {
    const out = fresh('Song.aiff')

    const { written } = await replace(later, out, join(dir, 'gone.wav'))

    expect(existsSync(out)).toBe(true)
    expect(written.replaceShift).toEqual({ unmoved: 'unreadable' })
  }, 120_000)

  // A cancel has to stop the batch at once: the measurement's ffmpegs hold the old file open
  // (on Windows that blocks the next rename), and the DJ's file must be left exactly as it was.
  it('stops on a cancel during the measurement and leaves the old file as it was', async () => {
    const oldFile = fresh('old.wav')
    copyFileSync(oldWav, oldFile)
    const before = sha(oldFile)
    let cancelled = false
    let tmp = ''
    const decodes: { exitCode: number | null; signalCode: string | null }[] = []
    watch.onDecode = (args, child) => {
      if (!args.includes(oldFile) || !args.includes('f32le')) return
      cancelled = true
      decodes.push(child)
    }

    await expect(
      replace(later, fresh('Song.aiff'), oldFile, {
        isCancelled: () => cancelled,
        onTmp: (p) => {
          tmp = p
        },
      }),
    ).rejects.toThrow(/^SURCO_ERR:conversionCancelled$/)

    expect(decodes.length).toBeGreaterThan(0)
    for (const child of decodes) {
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(child.exitCode).not.toBe(0)
    }
    expect(sha(oldFile)).toBe(before)
    expect(existsSync(tmp)).toBe(false)
  }, 120_000)

  // Serato's cues come from the replaced file. The measure is taken on the finished file,
  // which already lacks the trimmed half second, so taking the trim off again would put every
  // cue half a second early.
  it("carries the replaced file's Serato cues 1.5 s later, without counting the trim twice", async () => {
    const oldFile = fresh('old.wav')
    copyFileSync(oldWav, oldFile)
    setSeratoMarkers(
      oldFile,
      withSeratoCues(null, [{ index: 0, ms: 10000, color: 0xcc0000, name: 'Drop' }]),
    )
    const out = fresh('Song.aiff')

    const { written } = await replace(later, out, oldFile, { trim: { startSec: 0.5 } })

    near((written.replaceShift as { moved: number }).moved, 1000)
    const track = readSeratoTrack(out)
    const lead = await seratoLeadOfFile(out, track?.sampleRate ?? 44100)
    near((track?.markers?.cues[0]?.ms ?? Number.NaN) - lead, 11000)
  }, 120_000)

  // Only a replacement has a file to measure against; an ordinary conversion must not claim
  // a shift the self-check or the UI would then report.
  it('reports no replace shift on an ordinary conversion', async () => {
    const { written } = await replace(later, fresh('Song.aiff'), undefined)

    expect(written.replaceShift).toBeUndefined()
  }, 120_000)
})
