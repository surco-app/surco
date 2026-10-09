import type {
  DuplicateReplaceOutcome,
  LibraryTagUpdate,
  ListRemoval,
  MusicFileLookup,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { listReviewEntries, withListChanges } from './listReviewEntries'
import type { ReviewSource } from './reviewSource'

export interface ListSourceDeps {
  rows: () => TrackItem[]
  mac: boolean
  // Whether Music may be opened to answer; otherwise it is asked only if already open.
  launchMusic: () => boolean
  onRowsRemoved: (paths: string[]) => void
}

export function listReviewSource(deps: ListSourceDeps): ReviewSource {
  let lookup: MusicFileLookup | null = null
  let snapshot: { rows: TrackItem[]; byPath: Map<string, TrackItem> } | null = null
  const changes: LibraryTagUpdate[] = []
  const gone = new Set<string>()
  const music = (id: string) => lookup?.entries[id] ?? []
  const only = (id: string) => (music(id).length === 1 ? music(id)[0] : undefined)
  // Main reads an absent ref as "Music has no entry"; that is only true when Music answered.
  const musicOf = (removeId: string, keepId: string): ListRemoval['music'] => {
    if (!lookup) return undefined
    if (!lookup.consulted) return 'unknown'
    const found = music(removeId)
    if (found.length === 0) return undefined
    if (found.length > 1) return 'ambiguous'
    const keep = only(keepId)
    return {
      removePid: found[0].persistentId,
      label: found[0].label,
      ...(keep && { keep: { persistentId: keep.persistentId, label: keep.label } }),
    }
  }
  return {
    kind: 'list',
    load: async () => {
      const read = listReviewEntries(deps.rows())
      const entries = withListChanges(read.entries, changes, gone)
      if (!deps.mac) return { entries, skipped: read.skipped }
      lookup = { consulted: false, entries: {} }
      lookup = await window.api.appleMusicFileEntries(
        entries.map((e) => ({ path: e.id, title: e.title })),
        deps.launchMusic(),
      )
      return { entries, skipped: read.skipped, musicConsulted: lookup.consulted }
    },
    locate: async (id) => id,
    applyFixes: (fixes) =>
      window.api.applyListFixes({
        fixes,
        music: Object.fromEntries(
          fixes.flatMap((f) => {
            const entry = only(f.id)
            return entry ? [[f.id, entry.persistentId]] : []
          }),
        ),
      }),
    onProgress: (cb) => window.api.onListFixProgress(cb),
    cancel: () => {
      void window.api.cancelListFixes()
    },
    // One call does it all in main, in the order the libraries need: DJ libraries, Music,
    // then the Trash.
    removeCopies: async (removals, { isCancelled, onStep, onDone, onCheckingMusic }) => {
      const run = { removed: [], replaced: [], librariesUntouched: false, replaceFailed: false }
      if (isCancelled()) return run
      onStep(1)
      const off = window.api.onListRemovalPhase(() => onCheckingMusic?.())
      let replaceFailed = false
      const replaced: DuplicateReplaceOutcome[] = await window.api
        .removeListDuplicates(
          removals.map((r) => {
            const ref = musicOf(r.removeId, r.keepId)
            return { from: r.removeId, to: r.keepId, ...(ref && { music: ref }) }
          }),
        )
        .catch(() => {
          replaceFailed = true
          return []
        })
        .finally(off)
      onDone(removals.length)
      return { ...run, replaced, replaceFailed }
    },
    revertMusic: async (outcome, fix) =>
      outcome.musicId
        ? window.api.setMusicField(outcome.musicId, fix.field, fix.to, fix.from)
        : undefined,
    inMusic: (id) => music(id).length > 0,
    facts: (id) => {
      const rows = deps.rows()
      if (snapshot?.rows !== rows) {
        const byPath = new Map<string, TrackItem>()
        for (const row of rows) if (!byPath.has(row.inputPath)) byPath.set(row.inputPath, row)
        snapshot = { rows, byPath }
      }
      return snapshot.byPath.get(id)
    },
    settle: (updates, trashed) => {
      changes.push(...updates)
      for (const path of trashed) gone.add(path)
      if (trashed.length) deps.onRowsRemoved(trashed)
    },
  }
}
