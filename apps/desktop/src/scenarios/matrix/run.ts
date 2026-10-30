import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { vi } from 'vitest'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { isEngineDjRunning } from '../../main/engineProcess'
import { isRekordboxRunning } from '../../main/rekordboxProcess'
import { isTraktorRunning } from '../../main/traktorProcess'
import { fromDestination } from '../../renderer/src/lib/destination'
import { supersededFile } from '../../renderer/src/lib/supersededFile'
import type { OutputFormat, Settings } from '../../shared/types'
import { osTrash } from '../electronFake'
import { music } from '../fakeMusic'
import { scenarioDir } from '../fixtures'
import { type ConflictChoice, openSurco, type Sabotage, type Scenario } from '../harness'
import { type Cell, type CellGroup, type Origin, qualitySettings } from './cells'
import { buildLibraries, type LibrarySet, type SeededTrack, syncedPrograms } from './libraries'
import {
  type Expected,
  fileInvariants,
  libraryInvariants,
  markerLagMs,
  originalBroken,
  pointingAt,
} from './oracle'
import type { CellOutcome } from './report'
import { makeSource } from './sources'

const EXTENSION: Record<OutputFormat, string> = {
  aiff: '.aiff',
  wav: '.wav',
  flac: '.flac',
  alac: '.m4a',
  mp3: '.mp3',
}
const SAME_FORMAT: Record<OutputFormat, string[]> = {
  aiff: ['.aif', '.aiff'],
  wav: ['.wav'],
  flac: ['.flac'],
  alac: ['.m4a'],
  mp3: ['.mp3'],
}
const LOSSLESS = new Set<Origin>(['wav16', 'wav24', 'aif', 'aiff', 'flac', 'alac'])
const OCCUPIER: Record<OutputFormat, Origin> = {
  aiff: 'aiff',
  wav: 'wav16',
  flac: 'flac',
  alac: 'alac',
  mp3: 'mp3n',
}

const LIBRARY_EXTRA: Record<string, { nfdRow?: boolean; twinRows?: boolean }> = {
  K07: { nfdRow: true },
  K08: { twinRows: true },
}
const NAME_TAKEN = new Set(['K12'])
const TRIM_LEAD_SEC = 2

const toMusic = (cell: Cell): boolean =>
  cell.dest === 'appleMusic' || cell.dest === 'appleMusicCopy'

function destinationSettings(cell: Cell): Partial<Settings> {
  if (cell.dest === 'appleMusicCopy')
    return { ...fromDestination('appleMusic'), keepOutputCopy: true }
  return fromDestination(cell.dest)
}

const sameFormat = (cell: Cell, source: string): boolean =>
  SAME_FORMAT[cell.target].includes(extname(source).toLowerCase())

const inPlace = (cell: Cell, source: string): boolean =>
  cell.dest !== 'beside' &&
  ((cell.dest === 'overwrite' && cell.target !== 'alac') || sameFormat(cell, source))

function writtenPath(cell: Cell, source: string, outputDir: string): string {
  const ext = EXTENSION[cell.target]
  const stem = basename(source, extname(source))
  if (cell.dest === 'beside') {
    const beside = join(dirname(source), `${stem}${ext}`)
    return existsSync(beside) ? join(dirname(source), `${stem} (2)${ext}`) : beside
  }
  return join(inPlace(cell, source) ? dirname(source) : outputDir, `${stem}${ext}`)
}

const spelled = (path: string): string => {
  try {
    return join(realpathSync(dirname(path)), basename(path)).normalize('NFC')
  } catch {
    return path.normalize('NFC')
  }
}

function musicPlays(set: LibrarySet, t: SeededTrack): string | null | undefined {
  const stem = basename(t.path, extname(t.path)).normalize('NFC')
  const seeded = new Set([...set.tracks, set.bystander].map((x) => x.musicPid))
  const named = (location: string | null) =>
    !!location &&
    spelled(location) !== spelled(t.path) &&
    basename(location).normalize('NFC').startsWith(stem)
  const added = music.state.entries.find((e) => !seeded.has(e.persistentId) && named(e.location))
  const kept = t.musicPid ? music.entry(t.musicPid) : undefined
  return (added ?? (kept && named(kept.location) ? kept : undefined))?.location
}

function rowName(surco: Scenario, source: string, written: string): string {
  const row = surco
    .tracks()
    .find(
      (t) => spelled(t.inputPath) === spelled(source) || spelled(t.inputPath) === spelled(written),
    )
  return basename(row?.inputPath ?? source)
}

function unreadableOnce(set: LibrarySet, cell: Cell): { sabotage: Sabotage; restore: () => void } {
  const files = syncedPrograms(cell.programs).map((program) => {
    if (program === 'rekordbox') return set.rekordboxDb
    if (program === 'engine') return set.engineDir && engineDbPath(set.engineDir)
    if (program === 'traktor') return set.traktorNml
    throw new Error('scenario: a first Music read that fails is not modelled')
  })
  const away = (file: string) => `${file}.lejos`
  let moved = false
  return {
    sabotage: {
      beforeLibraryCheck: () => {
        if (moved) return
        moved = true
        for (const file of files) if (file) renameSync(file, away(file))
      },
    },
    restore: () => {
      for (const file of files) if (file && existsSync(away(file))) renameSync(away(file), file)
    },
  }
}

function programsOpen(open: boolean): void {
  vi.mocked(isRekordboxRunning).mockResolvedValue(open)
  vi.mocked(isEngineDjRunning).mockResolvedValue(open)
  vi.mocked(isTraktorRunning).mockResolvedValue(open)
}

export async function runGroup(group: CellGroup): Promise<CellOutcome[]> {
  const [first] = group.cells
  const root = scenarioDir(`matriz-${first.id}`)
  const outputDir = join(root, 'Salida')
  const sources = group.cells.map((cell) =>
    makeSource(join(root, 'Origen'), cell.origin, {
      fileName: `${cell.id} Café Olé`,
      leadSilenceSec: cell.quality === 'trim' ? TRIM_LEAD_SEC : 0,
    }),
  )
  const witnesses = sources.map((s) => {
    const witness = join(root, 'Testigo', basename(s.path))
    mkdirSync(dirname(witness), { recursive: true })
    copyFileSync(s.path, witness)
    return { ...s, path: witness }
  })
  music.reset()
  if (toMusic(first)) music.state.mediaFolder = join(root, 'Music Media')
  const set = buildLibraries(root, first.programs, sources, LIBRARY_EXTRA[first.id])
  for (const [i, cell] of group.cells.entries())
    if (NAME_TAKEN.has(cell.id))
      makeSource(dirname(sources[i].path), OCCUPIER[cell.target], {
        fileName: basename(sources[i].path, extname(sources[i].path)),
        tags: { title: 'Ocupado', artist: 'Nadie' },
      })
  const written = group.cells.map((cell, i) => writtenPath(cell, sources[i].path, outputDir))
  const retry = first.state === 'retry' ? unreadableOnce(set, first) : undefined
  const keepBoth = group.cells.some((cell) => NAME_TAKEN.has(cell.id))
  const surco = await openSurco({
    verify: true,
    sabotage: retry?.sabotage,
    onConflict: keepBoth ? (): ConflictChoice => 'keepBoth' : undefined,
    settings: {
      ...set.settings,
      outputDir,
      outputFormat: first.target,
      autoApplyFilename: false,
      ...destinationSettings(first),
      ...qualitySettings(first.quality),
      ...first.settings,
    },
  })
  const names = sources.map((s) => basename(s.path))
  const openUntil: number[] = []
  const retried: ('rerun-job' | 'rechecked')[] = []
  try {
    if (first.state === 'open') programsOpen(true)
    await surco.drop(...sources.map((s) => s.path))
    if (first.quality === 'trim') await surco.trimDetectedSilence()
    if (first.dest === 'appleMusic') for (const name of names) await surco.convertInEditor(name)
    else await surco.convertAll('confirm', first.target)
    await surco.settled()
    if (first.state === 'open') {
      for (const [i, s] of sources.entries())
        openUntil[i] = surco.statuses(rowName(surco, s.path, written[i])).length
      programsOpen(false)
      await surco.rekordboxClosed()
      await surco.engineClosed()
      await surco.traktorClosed()
      await surco.settled()
    }
    if (retry) {
      retry.restore()
      for (const [i, s] of sources.entries())
        retried[i] = await surco.retry(rowName(surco, s.path, written[i]))
      await surco.settled()
    }
  } finally {
    programsOpen(false)
    retry?.restore()
    surco.close()
  }
  return Promise.all(
    group.cells.map(async (cell, i): Promise<CellOutcome> => {
      const source = sources[i]
      const witness = witnesses[i]
      const track = set.tracks[i]
      const finalPath = (toMusic(cell) && musicPlays(set, track)) || written[i]
      const name = rowName(surco, source.path, written[i])
      const row = surco.tracks().find((t) => basename(t.inputPath) === name)
      const verdict = surco.verification(name)
      const fileExists = existsSync(finalPath)
      const consumed = cell.dest === 'overwrite' && inPlace(cell, source.path)
      const expected: Expected = {
        finalPath,
        at: {
          ...pointingAt(finalPath),
          traktor:
            spelled(dirname(finalPath)) === spelled(dirname(source.path)) ? finalPath : source.path,
        },
        lagMs: fileExists ? markerLagMs(witness.path, finalPath) : 0,
        samplesKept:
          cell.quality === 'source' &&
          ((LOSSLESS.has(cell.origin) && cell.target !== 'mp3') || sameFormat(cell, source.path)),
        destGone: consumed,
      }
      return {
        cell,
        finalPath,
        fileExists,
        verdict,
        statuses: surco.statuses(name),
        openUntil: openUntil[i],
        retry: retried[i],
        broken: [
          ...fileInvariants(cell, witness, finalPath, source.coverSha1),
          ...libraryInvariants(cell, set, track, expected),
          ...originalBroken({
            status: verdict?.status,
            sourcePath: source.path,
            finalPath,
            originals: (await surco.trash.list()).map((entry) => entry.originalPath),
            osTrash,
            offered: row ? supersededFile(row) : null,
          }),
        ],
      }
    }),
  )
}
