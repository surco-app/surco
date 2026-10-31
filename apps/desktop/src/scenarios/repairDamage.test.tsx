// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, waitFor } from '@testing-library/react'
import ffmpegStatic from 'ffmpeg-static'
import { Id3v2Settings, File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(true) }))
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { loadSqlJs } from '../main/engine'
import { decodeQuickCues, decodeTrackData, inflateEngineBlob } from '../main/engineBlobs'
import { analysedTrack, beatDataBlob, trackDataBlob } from '../main/enginePerformanceFixture'
import { engineDbPath, writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import { probeDuration, readTags, toNmlLocation } from '../main/ffmpeg'
import { readGenreFrame } from '../main/genreFrame'
import { backupOf } from '../main/libraryBackups'
import { buildTraktorTree, id3WithPriv, injectAiffPriv, traktorCue } from '../main/traktor4Fixture'
import { bootVolumeName } from '../main/traktorNmlLibrary'
import type { MusicReview } from '../renderer/src/hooks/useMusicReview'
import type { DamageOutcome } from '../shared/types'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

const FF = ffmpegStatic as unknown as string
const WRITTEN = 'House; Deep House'
const DAMAGED = '(35) Deep House'
const tree = (shift: number) =>
  buildTraktorTree([
    traktorCue('Intro', 0, 10000 + shift, 0),
    traktorCue('Break', 0, 15000 + shift, 1),
  ])

function damagedMp3(path: string): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=3',
    '-id3v2_version',
    '3',
    '-metadata',
    'title=Damaged',
    '-metadata',
    'artist=A',
    '-metadata',
    `genre=${WRITTEN}`,
    path,
  ])
  Id3v2Settings.useNonStandardV2V3GenreSeparators = true
  const f = TagFile.createFromPath(path)
  try {
    void f.tag.genres
    f.tag.comment = 'cue pass'
    f.save()
  } finally {
    f.dispose()
    Id3v2Settings.useNonStandardV2V3GenreSeparators = false
  }
}

function entry(path: string, body: string): string {
  const { volume, dir, file } = toNmlLocation(path)
  const vol = volume || bootVolumeName()
  return `<ENTRY TITLE="${file}"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${vol}" VOLUMEID="${vol}"></LOCATION>${body}</ENTRY>`
}

const cuesAt = (shift: number) =>
  [
    ['Intro', 10000, 0],
    ['Break', 15000, 1],
  ]
    .map(
      ([name, ms, hot]) =>
        `<CUE_V2 NAME="${name}" DISPL_ORDER="0" TYPE="0" START="${((ms as number) + shift).toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${hot}"></CUE_V2>`,
    )
    .join('')

async function engineRow(library: string) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(engineDbPath(library)))
  try {
    const [[length, trackData, quickCues]] = db.exec(
      'SELECT t.length, p.trackData, p.quickCues FROM Track t JOIN PerformanceData p ON p.trackId = t.id',
    )[0].values
    const track = decodeTrackData(inflateEngineBlob(trackData as Uint8Array))
    const cues = decodeQuickCues(inflateEngineBlob(quickCues as Uint8Array))
    return { length, rate: track?.sampleRate, firstCue: cues?.slots[0]?.cue?.sample }
  } finally {
    db.close()
  }
}

// Three things the v1.18 fixes stopped breaking, already broken on disk: a genre TagLib
// rewrote as an ID3v1 number, a Traktor MP3 entry that took its AIFF's calibrated cues, and
// an Engine DJ row analysed at 48 kHz on a file that is 44.1 now. The review finds each with
// its proof and repairs them with a backup first.
describe('Repair what earlier versions left damaged', () => {
  let surco: Scenario
  let review: () => MusicReview
  let folder: string
  let library: string
  let nml: string
  let nmlBefore: string
  let found: { kind: string; certainty: string; staged: boolean }[]
  let outcomes: DamageOutcome[]
  let genreAfter: string
  let engineAfter: Awaited<ReturnType<typeof engineRow>>
  let backups: string[]
  let seconds: number

  beforeAll(async () => {
    const root = scenarioDir('repair-damage')
    folder = join(root, 'Crate')
    mkdirSync(folder, { recursive: true })
    mkdirSync(join(root, 'Converted'))
    damagedMp3(join(folder, 'damaged.mp3'))
    const bare = join(root, 'bare.mp3')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=20:r=44100',
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-write_id3v2',
      '0',
      bare,
    ])
    const uno = join(folder, 'uno.mp3')
    writeFileSync(uno, Buffer.concat([id3WithPriv(tree(0)), readFileSync(bare)]))
    const aiff = join(root, 'Converted', 'uno.aiff')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=20:r=44100',
      '-ac',
      '2',
      aiff,
    ])
    injectAiffPriv(aiff, tree(-51.18))
    const wav = join(folder, 'engine.wav')
    makeTrack(wav, { title: 'Engine', artist: 'A', signal: 'tone' })
    nml = join(root, 'collection.nml')
    writeFileSync(
      nml,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?><NML VERSION="19"><COLLECTION ENTRIES="3">${[
        entry(join(folder, 'damaged.mp3'), `<INFO GENRE="${WRITTEN}"></INFO>`),
        entry(uno, `<INFO></INFO>${cuesAt(-51.18)}`),
        entry(aiff, `<INFO></INFO>${cuesAt(-51.18)}`),
      ].join('')}</COLLECTION></NML>`,
    )
    nmlBefore = readFileSync(nml, 'utf8')
    library = join(root, 'Engine Library')
    const sec = (await probeDuration(wav)) ?? 0
    seconds = Math.round(sec)
    const db = writeEngineLibraryFixture(library, {
      tracks: [{ id: 1, path: relative(library, wav), length: 999 }],
      playlists: [],
      entities: [],
      performance: [
        {
          ...analysedTrack(1, [{ label: 'Drop', sample: 2 * 48000, argb: 0xffcc0000 }]),
          trackData: trackDataBlob(48000, Math.round(sec * 48000)),
          beatData: beatDataBlob(48000, Math.round(sec * 48000), [
            [0, 0],
            [Math.round(sec * 48000), 10],
          ]),
        },
      ],
    })
    db.prepare('UPDATE Track SET fileBytes = ? WHERE id = 1').run(statSync(wav).size)
    db.close()

    surco = await openSurco({
      settings: {
        syncTraktor: true,
        traktorNmlPath: nml,
        syncEngineDj: true,
        engineLibraryDir: library,
      },
    })
    await surco.drop(folder)
    review = await surco.openListReview()
    await waitFor(() => expect(review().damageLoading).toBe(false), { timeout: 60_000 })
    await waitFor(() => expect(review().damage.map((f) => f.kind)).toHaveLength(3))
    found = review().damage.map((f) => ({
      kind: f.kind,
      certainty: f.certainty,
      staged: review().staged.has(`damage:${f.id}`),
    }))
    for (const kind of ['engine-cues', 'traktor-source-cues']) {
      const key = `damage:${review().damage.find((f) => f.kind === kind)?.id}`
      act(() => review().toggleStaged(key))
    }
    await act(async () => review().apply())
    outcomes = review().lastRun?.damage ?? []
    genreAfter = (await readTags(join(folder, 'damaged.mp3'))).genre
    engineAfter = await engineRow(library)
    backups = (await surco.trash.list()).map((e) => e.originalPath)
    await act(async () => review().undo())
  }, 180_000)

  // No library copy says whether the DJ moved Engine's cues by hand, and no Copias record
  // links the MP3 to its AIFF: those two wait for the user, who stages them.
  it('finds the three, staging the proven ones', () => {
    expect(found.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'engine-cues', certainty: 'likely', staged: false },
      { kind: 'genre-number', certainty: 'sure', staged: true },
      { kind: 'traktor-source-cues', certainty: 'likely', staged: false },
    ])
  })

  it('repairs the genre and Engine DJ, and holds Traktor while it is open', () => {
    const state = (prefix: string) => outcomes.find((o) => o.id.startsWith(prefix))?.state
    expect(state('genre-')).toBe('repaired')
    expect(state('traktor-')).toBe('pending')
    expect(state('engine-')).toBe('repaired')
  })

  it('writes the genre the user wrote, readable by every program', () => {
    expect(genreAfter).toBe(WRITTEN)
  })

  it('moves Engine DJ to the file rate with its cue at the same time and its length', () => {
    expect(engineAfter.rate).toBe(44100)
    expect(engineAfter.firstCue).toBeCloseTo(2 * 44100, 0)
    expect(engineAfter.length).toBe(seconds)
  })

  it('keeps a copy of the file and of the Engine DJ library before writing', () => {
    expect(backups).toContain(join(folder, 'damaged.mp3'))
    expect(existsSync(backupOf(engineDbPath(library), 'backup'))).toBe(true)
  })

  it('leaves the open Traktor collection untouched', () => {
    expect(readFileSync(nml, 'utf8')).toBe(nmlBefore)
  })

  it('brings back only the genre on Undo', async () => {
    expect(readGenreFrame(join(folder, 'damaged.mp3'))?.raw).toBe(DAMAGED)
    expect((await engineRow(library)).rate).toBe(44100)
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })
})
