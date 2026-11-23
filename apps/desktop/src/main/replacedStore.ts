import { readFileSync, renameSync, writeFileSync } from 'node:fs'
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
    Array.isArray(x.pending)
  )
}

const normalized = (e: ReplacedEntry): ReplacedEntry => ({
  ...e,
  newPath: nfc(e.newPath),
  oldPath: nfc(e.oldPath),
})

export function createReplacedStore(file: string): ReplacedStore {
  const load = (): ReplacedEntry[] => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoreFile>
      return Array.isArray(data.entries) ? data.entries.filter(isEntry) : []
    } catch {
      return []
    }
  }
  const save = (entries: ReplacedEntry[]): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies StoreFile))
    renameSync(tmp, file)
  }
  return {
    list: load,
    add: (entry) => {
      const next = normalized(entry)
      save([
        ...load().filter((e) => e.newPath !== next.newPath && e.newPath !== next.oldPath),
        next,
      ])
    },
    review: (path, programs) => {
      const p = nfc(path)
      const all = load()
      const found = all.find((e) => e.newPath === p || e.oldPath === p)
      if (!found) return null
      const pending = programs ? found.pending.filter((x) => !programs.includes(x)) : []
      save(
        pending.length === 0
          ? all.filter((e) => e !== found)
          : all.map((e) => (e === found ? { ...e, pending } : e)),
      )
      return found
    },
    restore: (entry) => {
      const next = normalized(entry)
      save([...load().filter((e) => e.newPath !== next.newPath), next])
    },
    movePath: (from, to) => {
      const [f, t] = [nfc(from), nfc(to)]
      save(load().map((e) => (e.newPath === f ? { ...e, newPath: t } : e)))
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
    musicLandedPath?: string
    skipped?: boolean
    replaceShift?: ReplaceShift
  },
  programs: DjProgram[],
  now: number,
): void {
  const landed = result.outputPath || result.musicLandedPath
  if (!job.replacesPath || result.skipped || !landed || programs.length === 0) return
  store.add({
    newPath: landed,
    oldPath: job.replacesPath,
    replacedAt: now,
    shift: result.replaceShift ?? { unmoved: 'unreadable' },
    pending: programs,
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
