// @vitest-environment jsdom
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())
vi.mock('../../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('../../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => false) }))
vi.mock('../../main/virtualdjProcess', () => ({
  isVirtualdjRunning: vi.fn(async () => false),
  waitForVirtualdjExit: vi.fn(async () => true),
}))

import {
  appleMusicEntryLocation,
  appleMusicMediaFolder,
  appleScriptString,
  runOsascript,
} from '../../main/applemusic'
import { music } from '../fakeMusic'
import { scenarioDir } from '../fixtures'
import type { Sabotage } from '../harness'
import { CELLS, groupsOf } from './cells'
import type { LibrarySet, SeededTrack } from './libraries'
import { type CellOutcome, cellFailure, writeReport } from './report'
import { type RunHooks, runGroup } from './run'
import { OTHER_TITLE } from './sabotage'
import { makeSource } from './sources'

// Opt-in: the Music cells of the matrix against the real Music app, to catch the fake
// drifting from it. Run with SURCO_REAL_MUSIC=1 on a Mac with Music set up; every entry,
// playlist and file it makes is named with a random prefix and deleted after each batch,
// as the fake starts every batch empty, and nothing it does reaches an entry not its own.
const real = process.env.SURCO_REAL_MUSIC === '1'
const PREFIX = `Surco Matriz ${randomUUID().slice(0, 8)}`
const OSASCRIPT_MS = 100_000
const FS = '\u001f'
const RS = '\u001e'
const running = new Set<Promise<string>>()
const madeFiles = new Set<string>()
const notes: string[] = []

const MUSIC_CELLS = CELLS.filter(
  (c) => ['K01', 'K02', 'K03'].includes(c.id) || (c.layer === 'S' && c.programs === 'music'),
)

const ours = (path: string): boolean => path.includes(PREFIX)
const prefixed = (text: string): string => (text.startsWith(PREFIX) ? text : `${PREFIX} ${text}`)

function musicScript(script: string): Promise<string> {
  const call = runOsascript(script, { timeout: OSASCRIPT_MS })
  running.add(call)
  return call.finally(() => running.delete(call))
}

const tell = (...lines: string[]): string =>
  ['tell application "Music"', ...lines.map((l) => `  ${l}`), 'end tell'].join('\n')

const trackById = (pid: string): string =>
  `(first track of library playlist 1 whose persistent ID is ${appleScriptString(pid)})`

async function osascriptsDone(): Promise<void> {
  await Promise.allSettled(running)
  for (let i = 0; i < 600; i++) {
    const children = spawnSync('pgrep', ['-P', String(process.pid), '-x', 'osascript'])
    if (children.stdout.toString().trim() === '') return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('an osascript Surco started is still running after 5 minutes')
}

async function addOwn(path: string, t: SeededTrack['tags']): Promise<string> {
  madeFiles.add(path)
  const pid = (
    await musicScript(
      tell(
        'with timeout of 300 seconds',
        `  set theTrack to add POSIX file ${appleScriptString(path)}`,
        '  repeat 600 times',
        '    try',
        `      if name of theTrack does not start with ${appleScriptString(PREFIX)} then error "Music answered the add with an entry that is not this test's" number 9001`,
        `      set name of theTrack to ${appleScriptString(t.title)}`,
        `      set artist of theTrack to ${appleScriptString(t.artist)}`,
        `      set album of theTrack to ${appleScriptString(t.album)}`,
        `      set grouping of theTrack to ${appleScriptString(t.grouping)}`,
        '      exit repeat',
        '    on error errMsg number errNum',
        '      if errNum is not -50 then error errMsg number errNum',
        '      delay 0.1',
        '    end try',
        '  end repeat',
        '  return persistent ID of theTrack',
        'end timeout',
      ),
    )
  ).trim()
  const landed = await appleMusicEntryLocation(pid)
  if (landed && realpathSync(landed) !== realpathSync(path)) {
    madeFiles.add(landed)
    await musicScript(
      tell(`set location of ${trackById(pid)} to POSIX file ${appleScriptString(path)}`),
    )
  }
  return pid
}

async function makePlaylist(name: string, pids: string[]): Promise<string> {
  return (
    await musicScript(
      tell(
        `set p to make new user playlist with properties {name:${appleScriptString(name)}}`,
        ...pids.map((pid) => `duplicate ${trackById(pid)} to p`),
        'return persistent ID of p',
      ),
    )
  ).trim()
}

async function seedRealMusic(set: LibrarySet): Promise<void> {
  const seeded = [...set.tracks, set.bystander]
  for (const t of seeded) {
    t.musicPid = undefined
    t.playlists = { ...t.playlists, music: [] }
    t.tags = {
      ...t.tags,
      title: prefixed(t.tags.title),
      artist: prefixed(t.tags.artist),
      album: prefixed(t.tags.album),
    }
    if (extname(t.path).toLowerCase() === '.flac') {
      notes.push(`${t.tags.title}: Music no admite FLAC, la celda empieza sin entrada en Music`)
      continue
    }
    t.musicPid = await addOwn(t.path, t.tags)
  }
  const pids = seeded.flatMap((t) => (t.musicPid ? [t.musicPid] : []))
  const lists: string[] = []
  for (const name of ['Selección', 'Sábado']) lists.push(await makePlaylist(prefixed(name), pids))
  for (const t of seeded) if (t.musicPid) t.playlists = { ...t.playlists, music: lists }
}

interface RealEntry {
  pid: string
  location: string
  title: string
  artist: string
  album: string
  grouping: string
}

async function ownEntries(): Promise<RealEntry[]> {
  const out = await musicScript(
    [
      'set out to ""',
      tell(
        `repeat with t in (every track of library playlist 1 whose name starts with ${appleScriptString(PREFIX)})`,
        '  set loc to ""',
        '  try',
        '    set loc to POSIX path of (get location of t)',
        '  end try',
        `  set out to out & (persistent ID of t) & "${FS}" & loc & "${FS}" & (name of t) & "${FS}" & (artist of t) & "${FS}" & (album of t) & "${FS}" & (grouping of t) & "${RS}"`,
        'end repeat',
      ),
      'return out',
    ].join('\n'),
  )
  return out
    .split(RS)
    .filter((line) => line.trim())
    .map((line) => {
      const [pid, location, title, artist, album, grouping] = line.split(FS)
      return { pid: pid.trim(), location, title, artist, album, grouping }
    })
}

async function ownPlaylists(): Promise<{ pid: string; name: string; entries: string[] }[]> {
  const out = await musicScript(
    [
      'set out to ""',
      tell(
        `repeat with p in (every user playlist whose name starts with ${appleScriptString(PREFIX)})`,
        '  set ids to ""',
        '  repeat with t in (every track of p)',
        `    set ids to ids & (persistent ID of t) & "${FS}"`,
        '  end repeat',
        `  set out to out & (persistent ID of p) & "${FS}" & (name of p) & "${FS}" & ids & "${RS}"`,
        'end repeat',
      ),
      'return out',
    ].join('\n'),
  )
  return out
    .split(RS)
    .filter((line) => line.trim())
    .map((line) => {
      const [pid, name, ...entries] = line.split(FS)
      return { pid: pid.trim(), name, entries: entries.filter(Boolean) }
    })
}

// The oracle reads Music through the fake's state; here that state is loaded from the real
// app right before judging, so the same checks run over what Music really holds.
async function loadRealIntoOracle(): Promise<void> {
  const entries = await ownEntries()
  const playlists = await ownPlaylists()
  music.reset()
  for (const e of entries)
    music.addEntry({
      persistentId: e.pid,
      location: e.location || null,
      title: e.title,
      artist: e.artist,
      album: e.album,
      grouping: e.grouping,
    })
  for (const p of playlists)
    music.addPlaylist({ persistentId: p.pid, name: p.name, entries: p.entries })
}

async function addedEntry(set: LibrarySet): Promise<RealEntry> {
  const seeded = new Set([...set.tracks, set.bystander].map((t) => t.musicPid))
  const added = (await ownEntries()).filter((e) => !seeded.has(e.pid))
  if (added.length !== 1)
    throw new Error(`scenario: ${added.length} new Music entries, expected the one Surco added`)
  if (added[0].location) madeFiles.add(added[0].location)
  return added[0]
}

const onMusic = (edit: () => Promise<void>): Sabotage => ({
  beforeMusicCheck: () =>
    edit().catch((e: Error) => {
      notes.push(`avería sin aplicar: ${e.message}`)
      throw e
    }),
})

const REAL_SABOTAGES: RunHooks['sabotages'] = {
  musicMissing: (set) =>
    onMusic(async () => {
      const { pid } = await addedEntry(set)
      await musicScript(
        tell(
          `delete (every track of library playlist 1 whose persistent ID is ${appleScriptString(pid)})`,
        ),
      )
    }),
  musicWrongFile: (set, t) =>
    onMusic(async () => {
      const { pid } = await addedEntry(set)
      await musicScript(
        tell(`set location of ${trackById(pid)} to POSIX file ${appleScriptString(t.path)}`),
      )
    }),
  musicDuplicate: (set) =>
    onMusic(async () => {
      const entry = await addedEntry(set)
      const twin = makeSource(scenarioDir('matriz-music-twin'), 'aiff', {
        fileName: `${PREFIX} gemela`,
        tags: { title: `${PREFIX} gemela`, artist: entry.artist, album: entry.album },
      })
      const pid = await addOwn(twin.path, twin.tags)
      await musicScript(
        tell(
          `set location of ${trackById(pid)} to POSIX file ${appleScriptString(entry.location)}`,
          `set name of ${trackById(pid)} to ${appleScriptString(entry.title)}`,
        ),
      )
    }),
  musicTagDiffers: (set) =>
    onMusic(async () => {
      const { pid } = await addedEntry(set)
      await musicScript(
        tell(`set name of ${trackById(pid)} to ${appleScriptString(prefixed(OTHER_TITLE))}`),
      )
    }),
  musicPlaylistLost: (set, t) =>
    onMusic(async () => {
      const list = t.playlists.music[0]
      if (!list)
        throw new Error(
          'scenario: the source never had a Music entry, so the new one has no playlist to lose',
        )
      const { pid } = await addedEntry(set)
      await musicScript(
        tell(
          `delete (every track of (first user playlist whose persistent ID is ${appleScriptString(list)}) whose persistent ID is ${appleScriptString(pid)})`,
        ),
      )
    }),
}

const HOOKS: RunHooks = {
  realMusic: true,
  prefix: PREFIX,
  tags: {
    title: `${PREFIX} Café Olé`,
    artist: `${PREFIX} AC/DC`,
    album: `${PREFIX} Back In Black`,
  },
  prepared: seedRealMusic,
  sabotages: REAL_SABOTAGES,
  beforeJudge: loadRealIntoOracle,
}

function removeEmptyParents(file: string, stop: string): void {
  for (let dir = dirname(file); dir.startsWith(`${stop}/`); dir = dirname(dir)) {
    try {
      rmdirSync(dir)
    } catch {
      return
    }
  }
}

async function cleanUp(): Promise<void> {
  const left: string[] = []
  const failed = (what: string) => (e: unknown) => {
    left.push(`${what}: ${e instanceof Error ? e.message : String(e)}`)
  }
  await osascriptsDone().catch(failed('waiting for the osascripts in flight'))
  const entries = await ownEntries().catch((e) => {
    failed(`listing the Music entries named ${PREFIX}`)(e)
    return []
  })
  for (const e of entries) {
    if (e.location) madeFiles.add(e.location)
    await musicScript(
      tell(
        `delete (every track of library playlist 1 whose persistent ID is ${appleScriptString(e.pid)})`,
      ),
    ).catch(failed(`deleting Music entry ${e.pid}`))
  }
  const playlists = await ownPlaylists().catch((e) => {
    failed(`listing the Music playlists named ${PREFIX}`)(e)
    return []
  })
  for (const p of playlists)
    await musicScript(
      tell(`delete (every user playlist whose persistent ID is ${appleScriptString(p.pid)})`),
    ).catch(failed(`deleting Music playlist ${p.name}`))
  await ownEntries().then(
    (still) => {
      for (const e of still) left.push(`Music entry ${e.pid} is still there (${e.location})`)
    },
    failed(`checking the Music entries named ${PREFIX} are gone`),
  )
  await ownPlaylists().then(
    (still) => {
      for (const p of still) left.push(`Music playlist ${p.name} is still there`)
    },
    failed(`checking the Music playlists named ${PREFIX} are gone`),
  )
  const media = await appleMusicMediaFolder().catch((e) => {
    failed('finding the Music media folder')(e)
    return undefined
  })
  for (const file of madeFiles) {
    if (!ours(file)) continue
    try {
      rmSync(file, { force: true })
      if (media) removeEmptyParents(file, join(media, 'Music'))
    } catch (e) {
      failed(file)(e)
    }
  }
  const folders = media ? join(media, 'Music') : ''
  let names: string[] = []
  try {
    names = folders ? readdirSync(folders).filter((n) => n.startsWith(PREFIX)) : []
  } catch (e) {
    failed(`listing ${folders}`)(e)
  }
  for (const name of names) {
    try {
      rmSync(join(folders, name), { recursive: true, force: true })
    } catch (e) {
      failed(join(folders, name))(e)
    }
  }
  if (left.length > 0) throw new Error(`the cleanup left behind\n${left.join('\n')}`)
}

describe.skipIf(!real)('Matriz de resultados (Music real)', () => {
  const outcomes: CellOutcome[] = []

  afterAll(async () => {
    try {
      if (outcomes.length > 0) {
        const path = writeReport(outcomes)
        if (notes.length > 0) appendFileSync(path, ['## Notas', '', ...notes, ''].join('\n'))
      }
    } finally {
      await cleanUp()
    }
  }, 600_000)

  for (const group of groupsOf(MUSIC_CELLS)) {
    describe(group.key, () => {
      const byId = new Map<string, CellOutcome>()

      beforeAll(async () => {
        try {
          for (const outcome of await runGroup(group, HOOKS)) {
            byId.set(outcome.cell.id, outcome)
            outcomes.push(outcome)
          }
        } finally {
          await cleanUp()
        }
      }, 600_000)

      for (const cell of group.cells) {
        it(cell.name, () => {
          const outcome = byId.get(cell.id)
          if (!outcome) throw new Error(`sin resultado para ${cell.id}`)
          expect(cellFailure(outcome)).toBeNull()
        })
      }
    })
  }
})
