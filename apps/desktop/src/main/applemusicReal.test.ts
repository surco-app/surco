import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { errorKeyOf } from '../shared/errorKeys'
import { emptyMetadata } from '../shared/metadata'
import type { OutputFormat, Settings, TrackMetadata } from '../shared/types'
import {
  addToAppleMusic,
  appleMusicEntry,
  appleMusicEntryLocation,
  appleScriptString,
  carryOverToAppleMusicCopy,
  deleteFromAppleMusic,
  markAppleMusicReplacing,
  readMusicEntryFacts,
  runOsascript,
} from './applemusic'
import type { ConversionPlan } from './ffmpeg'
import { type ProcessTrackDeps, runProcessTrack } from './processTrack'
import { checkAppleMusic, type MusicReaders, musicEntriesForFile } from './verifyMusic'

// Opt-in: drives the real Music app with throwaway tones, for the measurements the unit
// tests can only assume (Music handing back an entry it already has, the replace sequence
// end to end). Run with SURCO_REAL_MUSIC=1 on a Mac with Music set up; every entry it makes
// is named with a random prefix and deleted, with its file, afterwards.
const real = process.env.SURCO_REAL_MUSIC === '1'
const FF = ffmpegStatic as unknown as string
const PREFIX = `Surco Real Test ${Math.random().toString(36).slice(2, 8)}`
const ARTIST = 'Surco Real Test'
const ALBUM = 'Surco Real Test Album'
const dir = real ? mkdtempSync(join(tmpdir(), 'surco-real-music-')) : ''
// Deleting an entry leaves its file, which may be Music's own Media copy.
const deletedFiles: string[] = []

function meta(title: string): TrackMetadata {
  return { ...emptyMetadata(), title, artist: ARTIST, album: ALBUM }
}

function tone(file: string, title: string, frequency = 440): string {
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=3`,
    ...(file.endsWith('.aiff') ? ['-write_id3v2', '1'] : []),
    '-metadata',
    `title=${title}`,
    '-metadata',
    `artist=${ARTIST}`,
    '-metadata',
    `album=${ALBUM}`,
    file,
  ])
  return file
}

async function entriesNamed(name: string): Promise<{ pid: string; path: string }[]> {
  const out = await runOsascript(
    [
      'set out to ""',
      'tell application "Music"',
      `  set found to (every track of library playlist 1 whose name is ${appleScriptString(name)})`,
      '  repeat with t in found',
      '    set loc to ""',
      '    try',
      '      set loc to POSIX path of (get location of t)',
      '    end try',
      '    set out to out & (persistent ID of t) & tab & loc & linefeed',
      '  end repeat',
      'end tell',
      'return out',
    ].join('\n'),
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [pid, path] = line.split('\t')
      return { pid, path }
    })
}

const productionReaders: MusicReaders = {
  entry: readMusicEntryFacts,
  entriesForFile: musicEntriesForFile({
    run: runOsascript,
    realPath: (p) => realpathSync(p),
  }),
  realPath: (p) => realpathSync(p),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

async function locationOf(pid: string): Promise<string> {
  const facts = await readMusicEntryFacts(pid)
  if (facts === 'missing' || !facts.location) throw new Error(`entry ${pid} has no file`)
  return facts.location
}

async function checkEntry(pid: string, title: string, replacedPid?: string) {
  const file = await locationOf(pid)
  return checkAppleMusic(
    {
      pid,
      file,
      ext: extname(file),
      meta: { title, artist: ARTIST, album: ALBUM },
      coverSet: false,
      replaced: replacedPid ? { oldPid: replacedPid, playlistsBefore: [] } : undefined,
    },
    productionReaders,
  )
}

function deps(): ProcessTrackDeps {
  return {
    settings: {
      coverMaxSize: 1000,
      coverSquare: false,
      outputFormat: 'aiff',
      outputDir: join(dir, 'out'),
      overwriteOriginal: false,
      addToAppleMusic: true,
      keepOutputCopy: true,
      normalize: { mode: 'none' },
      declick: { mode: 'off', noise: 'off' },
    } as Settings,
    platform: 'darwin',
    sendProgress: () => {},
    hasCoverSource: () => false,
    prepareProcessedCover: async () => undefined,
    convertAudio: async (input, output, _format, m) => {
      execFileSync(FF, [
        '-v',
        'error',
        '-y',
        '-i',
        input,
        ...(output.endsWith('.aiff') ? ['-write_id3v2', '1'] : []),
        '-metadata',
        `title=${m.title}`,
        '-metadata',
        `artist=${m.artist}`,
        '-metadata',
        `album=${m.album}`,
        output,
      ])
      return {
        normalizeSkipped: false,
        written: {
          samplesKept: false,
          originalKept: false,
          plan: { ext: extname(output) as ConversionPlan['ext'], codec: 'pcm_s16be' },
          trimmedSec: 0,
        },
      }
    },
    registerActiveConversion: () => {},
    unregisterActiveConversion: () => {},
    beginJob: () => {},
    endJob: () => {},
    trackTmp: () => {},
    untrackTmp: () => {},
    recordConversion: () => {},
    removeRenamedOriginal: async () => {},
    addToAppleMusic: (target, m, cover) => addToAppleMusic(target, m, cover),
    updateInAppleMusic: async () => {
      throw new Error('a replacement must never fall back to an update')
    },
    addToEngineDj: async () => {},
    allowMedia: () => {},
    existsSync,
    isSameFile: async () => false,
    fileIdentity: async () => undefined,
    mkdir,
    mkdtemp,
    rm,
    rmdir,
    confirmConflict: async () => 'keepBoth',
    isPathReserved: () => false,
    reservePath: () => {},
    releasePath: () => {},
    appleMusicEntryLocation,
    appleMusicEntry: (pid) => appleMusicEntry(pid),
    deleteAppleMusic: async (pid, label) => {
      const file = await deleteFromAppleMusic(pid, label)
      if (file) deletedFiles.push(file)
      return file
    },
    carryAppleMusicHistory: (from, to, label) => carryOverToAppleMusicCopy(from, to, label),
    markAppleMusicReplacing: (pid, label, marked) => markAppleMusicReplacing(pid, label, marked),
    appleMusicPlaylists: (pid) =>
      readMusicEntryFacts(pid, undefined, { withPlaylists: true }).then((facts) =>
        facts === 'missing' ? [] : facts.playlists,
      ),
    verifyFile: async () => ({ place: 'file', state: 'ok', detail: { key: 'fileReencoded' } }),
    verifyMusic: async () => ({
      place: 'appleMusic',
      state: 'unreadable',
      detail: { key: 'musicUnreadable' },
    }),
  }
}

async function replaceCase(from: 'wav' | 'aiff', to: OutputFormat, title: string): Promise<void> {
  const source = tone(join(dir, `${title}.${from}`), title, 523)
  const oldPid = await addToAppleMusic(source, meta(title))

  const result = await runProcessTrack(
    {
      id: title,
      inputPath: source,
      outputName: `${PREFIX} ${to} out`,
      meta: meta(title),
      format: to,
      musicPersistentId: oldPid,
      addToAppleMusic: true,
      keepOutputCopy: true,
    },
    deps(),
  )

  expect(result.appleMusicFailed).toBeUndefined()
  expect(result.oldMusicCopyKept).toBeUndefined()
  expect(result.musicPersistentId).not.toBe(oldPid)
  const left = await entriesNamed(title)
  expect(left).toHaveLength(1)
  expect(left[0].pid).toBe(result.musicPersistentId)
  expect(left[0].path).toMatch(to === 'aiff' ? /\.aiff?$/i : /\.wav$/i)
  expect(await entriesNamed(`${title} [surco-replacing]`)).toHaveLength(0)
  expect(await readMusicEntryFacts(oldPid)).toBe('missing')
  const verdict = await checkEntry(result.musicPersistentId as string, title, oldPid)
  expect(verdict.state).toBe('ok')
  expect(verdict.detail.key).toMatch(/^musicOne/)
}

describe.skipIf(!real)('Apple Music against the real app', () => {
  afterAll(async () => {
    const out = await runOsascript(
      [
        'set out to ""',
        'tell application "Music"',
        `  set found to (every track of library playlist 1 whose name starts with ${appleScriptString(PREFIX)})`,
        '  set pids to {}',
        '  repeat with t in found',
        '    set end of pids to persistent ID of t',
        '    try',
        '      set out to out & (POSIX path of (get location of t)) & linefeed',
        '    end try',
        '  end repeat',
        '  repeat with p in pids',
        '    delete (every track of library playlist 1 whose persistent ID is (contents of p))',
        '  end repeat',
        'end tell',
        'return out',
      ].join('\n'),
    )
    for (const file of [...out.split('\n').filter(Boolean), ...deletedFiles])
      rmSync(file, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }, 120_000)

  it('adds a new track nothing in the library shares a name with', async () => {
    const title = `${PREFIX} Plain`
    const pid = await addToAppleMusic(tone(join(dir, `${title}.aiff`), title), meta(title))

    expect(pid).toMatch(/^[0-9A-F]{16}$/)
    expect((await appleMusicEntry(pid)).label).toBe(`${ARTIST} - ${title}`)
  }, 120_000)

  it('reads back an entry it just added, and reports a missing one', async () => {
    const title = `${PREFIX} Readback`
    const pid = await addToAppleMusic(tone(join(dir, `${title}.aiff`), title), meta(title))

    const facts = await readMusicEntryFacts(pid, 'FFFFFFFFFFFFFFFF', { withPlaylists: true })

    expect(facts).not.toBe('missing')
    expect(facts).toMatchObject({
      name: title,
      artist: ARTIST,
      album: ALBUM,
      oldExists: false,
    })
    expect((facts as { location: string }).location).toMatch(/\.aiff?$/i)
    expect(await readMusicEntryFacts('FFFFFFFFFFFFFFFF')).toBe('missing')
  }, 120_000)

  // Measured 30/10: Music answers the add of a file matching an entry it has with that entry.
  it('refuses an add Music answers with the entry it already had, importing nothing', async () => {
    const title = `${PREFIX} Dup`
    const first = await addToAppleMusic(tone(join(dir, `${title}.wav`), title), meta(title))
    mkdirSync(join(dir, 'second'), { recursive: true })
    const second = tone(join(dir, 'second', `${title}.aiff`), title, 660)

    const failure = await addToAppleMusic(second, meta(title)).catch((e: Error) => e)

    expect(errorKeyOf((failure as Error).message)).toBe('appleMusicAddReturnedOld')
    const left = await entriesNamed(title)
    expect(left.map((e) => e.pid)).toEqual([first])
  }, 120_000)

  it('replaces a WAV entry with its AIFF, leaving one entry', async () => {
    await replaceCase('wav', 'aiff', `${PREFIX} W2A`)
  }, 240_000)

  it('replaces an AIFF entry with its WAV, leaving one entry', async () => {
    await replaceCase('aiff', 'wav', `${PREFIX} A2W`)
  }, 240_000)

  it('checks a fresh add ok against the real entry', async () => {
    const title = `${PREFIX} CheckPlain`
    const pid = await addToAppleMusic(tone(join(dir, `${title}.aiff`), title), meta(title))

    const verdict = await checkEntry(pid, title)

    expect(verdict.state).toBe('ok')
    expect(verdict.detail.key).toMatch(/^musicOne/)
  }, 120_000)

  it('checks musicDuplicate when two entries play one file', async () => {
    const title = `${PREFIX} CheckTwice`
    const first = await addToAppleMusic(tone(join(dir, `${title}.aiff`), title), meta(title))
    const otherTitle = `${title} other`
    const second = await addToAppleMusic(
      tone(join(dir, `${otherTitle}.aiff`), otherTitle, 660),
      meta(otherTitle),
    )
    const file = await locationOf(first)
    await runOsascript(
      [
        'tell application "Music"',
        `  set t to (first track of library playlist 1 whose persistent ID is ${appleScriptString(second)})`,
        `  set location of t to POSIX file ${appleScriptString(file)}`,
        `  set name of t to ${appleScriptString(title)}`,
        'end tell',
      ].join('\n'),
    )

    const verdict = await checkEntry(second, title)

    expect(verdict.state).toBe('mismatch')
    expect(verdict.detail.key).toBe('musicDuplicate')
  }, 120_000)

  it('never checks ok an entry whose file was deleted', async () => {
    const title = `${PREFIX} CheckGone`
    const pid = await addToAppleMusic(tone(join(dir, `${title}.aiff`), title), meta(title))
    const file = await locationOf(pid)
    rmSync(file, { force: true })

    const verdict = await checkEntry(pid, title).catch(() => undefined)

    expect(verdict).toBeDefined()
    expect(verdict?.state).not.toBe('ok')
    expect(['musicNoFile', 'musicUnreadable', 'musicOtherFile']).toContain(verdict?.detail.key)
  }, 120_000)
})
