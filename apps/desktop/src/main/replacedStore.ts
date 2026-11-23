import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import log from 'electron-log/main'
import { DJ_PROGRAMS, type DjProgram } from '../shared/djProgram'
import { DJ_REACH_SETTINGS } from '../shared/djSettings'
import type { ReplaceShift } from '../shared/replaceShift'
import type { ReplacedEntry } from '../shared/toReview'
import type { Settings } from '../shared/types'

export interface ReplacedStore {
  list(): ReplacedEntry[]
  add(entry: ReplacedEntry): void
  review(path: string, programs?: DjProgram[]): ReplacedEntry | null
  restore(entry: ReplacedEntry): void
  movePath(from: string, to: string): void
}

interface StoreFile {
  version: 1
  entries: ReplacedEntry[]
}

const nfc = (p: string): string => p.normalize('NFC')

function isEntry(e: unknown): e is ReplacedEntry {
  if (typeof e !== 'object' || e === null) return false
  const x = e as Record<string, unknown>
  return (
    typeof x.newPath === 'string' &&
    typeof x.oldPath === 'string' &&
    typeof x.replacedAt === 'number' &&
    typeof x.shift === 'object' &&
    x.shift !== null &&
    Array.isArray(x.pending) &&
    (x.formerPaths === undefined || Array.isArray(x.formerPaths))
  )
}

const normalized = (e: ReplacedEntry): ReplacedEntry => ({
  ...e,
  newPath: nfc(e.newPath),
  oldPath: nfc(e.oldPath),
  ...(e.formerPaths ? { formerPaths: e.formerPaths.map(nfc) } : {}),
})

// A file edited by hand may hold anything among the earlier paths, and every reader
// normalizes them: only strings are kept.
const withPathsOnly = (e: ReplacedEntry): ReplacedEntry =>
  e.formerPaths ? { ...e, formerPaths: e.formerPaths.filter((p) => typeof p === 'string') } : e

type Read = { entries: ReplacedEntry[]; state: 'ok' | 'absent' | 'corrupt' | 'unreadable' }

export function createReplacedStore(file: string): ReplacedStore {
  const read = (): Read => {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? { entries: [], state: 'absent' }
        : { entries: [], state: 'unreadable' }
    }
    try {
      const data = JSON.parse(text) as Partial<StoreFile>
      if (Array.isArray(data.entries))
        return { entries: data.entries.filter(isEntry).map(withPathsOnly), state: 'ok' }
    } catch {}
    return { entries: [], state: 'corrupt' }
  }
  const load = (): ReplacedEntry[] => read().entries
  const save = (entries: ReplacedEntry[]): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies StoreFile))
    renameSync(tmp, file)
  }
  // A write built on a failed read would erase every pending review: a transient read
  // error refuses the mutation, and a broken file is moved aside before it is replaced.
  const mutate = <T>(
    change: (entries: ReplacedEntry[]) => { entries: ReplacedEntry[]; out: T },
    none: T,
  ): T => {
    const { entries, state } = read()
    if (state === 'unreadable') {
      log.warn(`replaced-tracks store unreadable, change skipped: ${file}`)
      return none
    }
    if (state === 'corrupt') {
      const aside = `${file}.corrupt-${Date.now()}`
      renameSync(file, aside)
      log.warn(`replaced-tracks store was corrupt, kept as ${aside}`)
    }
    const { entries: next, out } = change(entries)
    save(next)
    return out
  }
  return {
    list: load,
    add: (entry) => {
      const next = normalized(entry)
      mutate(
        (all) => ({
          // The same track replaced again: from its new copy, or from the old file or an
          // earlier path a queued repoint still shows. Its review starts over under the
          // newest entry. An old file the new one lands on is another track's, so it stays.
          entries: [
            ...all.filter(
              (e) =>
                e.newPath !== next.newPath &&
                e.newPath !== next.oldPath &&
                e.oldPath !== next.oldPath &&
                !e.formerPaths?.includes(next.oldPath),
            ),
            next,
          ],
          out: undefined,
        }),
        undefined,
      )
    },
    review: (path, programs) => {
      const p = nfc(path)
      return mutate((all) => {
        // A save reviews what its programs still have pending, as the editor shows it. A
        // file can be one track's new copy and another's old one: it is the first's.
        const here = programs ? all.filter((e) => e.pending.some((x) => programs.includes(x))) : all
        const found =
          here.find((e) => e.newPath === p) ??
          here.find((e) => e.formerPaths?.includes(p)) ??
          here.find((e) => e.oldPath === p)
        if (!found) return { entries: all, out: null }
        const pending = programs ? found.pending.filter((x) => !programs.includes(x)) : []
        return {
          entries:
            pending.length === 0
              ? all.filter((e) => e !== found)
              : all.map((e) => (e === found ? { ...e, pending } : e)),
          out: found,
        }
      }, null)
    },
    restore: (entry) => {
      const next = normalized(entry)
      mutate(
        (all) => ({
          entries: [...all.filter((e) => e.newPath !== next.newPath), next],
          out: undefined,
        }),
        undefined,
      )
    },
    movePath: (from, to) => {
      const [f, t] = [nfc(from), nfc(to)]
      mutate(
        (all) => ({
          // Two entries at one path would make a review find the wrong one, so the entry
          // that was moved wins over whatever already sat at the destination.
          entries: all
            .filter((e) => e.newPath !== t || e.newPath === f || !all.some((x) => x.newPath === f))
            .map((e) =>
              e.newPath === f
                ? { ...e, newPath: t, formerPaths: [...(e.formerPaths ?? []), f] }
                : e,
            ),
          out: undefined,
        }),
        undefined,
      )
    },
  }
}

type FollowSettings = Pick<
  Settings,
  | 'syncRekordbox'
  | 'syncEngineDj'
  | 'syncTraktor'
  | 'syncSerato'
  | 'syncVirtualdj'
  | 'addToRekordbox'
  | 'addToEngineDj'
  | 'addToTraktor'
  | 'addToSerato'
  | 'addToVirtualdj'
>

export function followingPrograms(settings: FollowSettings): DjProgram[] {
  return DJ_PROGRAMS.filter(
    (p) => settings[DJ_REACH_SETTINGS[p].sync] || settings[DJ_REACH_SETTINGS[p].add],
  )
}

export function recordReplacement(
  store: ReplacedStore,
  job: { replacesPath?: string },
  result: {
    outputPath: string
    replacementLandedPath?: string
    skipped?: boolean
    replaceShift?: ReplaceShift
    seratoCarryFailed?: true
  },
  programs: DjProgram[],
  now: number,
): void {
  const landed = result.outputPath || result.replacementLandedPath
  const repointed = result.seratoCarryFailed ? programs.filter((p) => p !== 'serato') : programs
  if (!job.replacesPath || result.skipped || !landed || repointed.length === 0) return
  store.add({
    newPath: landed,
    oldPath: job.replacesPath,
    replacedAt: now,
    shift: result.replaceShift ?? { unmoved: 'unreadable' },
    pending: repointed,
  })
}

export function followReplaced(
  store: ReplacedStore,
  job: { inputPath: string },
  result: { outputPath: string; skipped?: boolean },
  exists: (path: string) => boolean,
): void {
  if (result.skipped) return
  if (job.inputPath !== result.outputPath && !exists(job.inputPath))
    store.movePath(job.inputPath, result.outputPath)
}

export function keepReplacedForReview(
  store: ReplacedStore,
  job: { inputPath: string; replacesPath?: string },
  result: Parameters<typeof recordReplacement>[2],
  programs: DjProgram[],
  now: number,
  exists: (path: string) => boolean,
): void {
  // The file has landed and the programs are repointed: a store that cannot be written
  // (a full disk, a broken file that cannot be moved aside) is logged, never a failed job,
  // and an older entry that cannot follow does not cost this job's own entry.
  try {
    followReplaced(store, job, result, exists)
  } catch (e) {
    log.error('replaced-tracks store: could not follow the converted file', e)
  }
  try {
    recordReplacement(store, job, result, programs, now)
  } catch (e) {
    log.error('replaced-tracks store: could not record the replacement', e)
  }
}
