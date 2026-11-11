import { fromReadOnlyProgram } from '../../../shared/trackOrigin'
import type {
  DuplicateReplaceOutcome,
  ListRemoval,
  MusicFileEntry,
  MusicFileLookup,
  ReviewedFileUpdate,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { duplicateGroups } from './duplicates'
import { type IncompleteRowDeps, incompleteOfRows } from './incompleteReview'
import { listReviewEntries, withListChanges } from './listReviewEntries'
import { spellingGroups } from './musicSpelling'
import type { ReviewSource } from './reviewSource'

export interface ListSourceDeps {
  rows: () => TrackItem[]
  mac: boolean
  // Whether Music may be opened to answer; otherwise it is asked only if already open.
  launchMusic: () => boolean
  onRowsRemoved: (paths: string[]) => void
  incomplete?: IncompleteRowDeps
}

export function listReviewSource(deps: ListSourceDeps): ReviewSource {
  let lookup: MusicFileLookup | null = null
  let snapshot: { rows: TrackItem[]; byPath: Map<string, TrackItem> } | null = null
  const changes: ReviewedFileUpdate[] = []
  const gone = new Set<string>()
  let titles = new Map<string, string>()
  // What Music answered for each file under each title, for this opening: a reload asks only
  // about a file it has no answer for. A write or removal on a file forgets its answer.
  const answered = new Map<string, MusicFileEntry[]>()
  const answerKey = (path: string, title: string) => `${path}\u0000${title}`
  const forget = (paths: string[]) => {
    for (const key of answered.keys())
      if (paths.some((path) => key.startsWith(answerKey(path, '')))) answered.delete(key)
  }
  const reviewable = () => deps.rows().filter((row) => !fromReadOnlyProgram(row))
  const seratoLeftOut = () =>
    new Set(deps.rows().flatMap((row) => (fromReadOnlyProgram(row) ? [row.inputPath] : []))).size
  const music = (id: string) => lookup?.entries[id] ?? []
  const only = (id: string) => (music(id).length === 1 ? music(id)[0] : undefined)
  // An absent ref sends the copy to main's own read of every Music location before the
  // Trash, which opens Music when it is closed: what the load could not ask is asked there.
  const musicOf = (removeId: string, keepId: string): ListRemoval['music'] => {
    if (!lookup?.consulted) return undefined
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
      const read = { ...listReviewEntries(reviewable()), seratoLeftOut: seratoLeftOut() }
      const entries = withListChanges(read.entries, changes, gone)
      titles = new Map(entries.map((e) => [e.id, e.title]))
      const incomplete =
        deps.incomplete &&
        incompleteOfRows(
          reviewable().filter((row) => !gone.has(row.inputPath)),
          (row) => row.inputPath,
          changes,
          deps.incomplete,
        )
      const found = incomplete ? { incomplete } : {}
      if (!deps.mac)
        return { entries, skipped: read.skipped, seratoLeftOut: read.seratoLeftOut, ...found }
      lookup = { consulted: false, entries: {} }
      // Only a grouped file is ever written or removed, so only those need Music; the rest of
      // a large list would cost about 15 ms each on a NAS library for nothing.
      const grouped = new Set([
        ...spellingGroups(entries).flatMap((g) => g.variants.flatMap((v) => v.ids)),
        ...duplicateGroups(entries).flatMap((g) => g.ids),
        ...(incomplete ?? []).map((f) => f.id),
      ])
      const asked = entries.filter(
        (e) => grouped.has(e.id) && !answered.has(answerKey(e.id, e.title)),
      )
      const answer = asked.length
        ? await window.api.appleMusicFileEntries(
            asked.map((e) => ({ path: e.id, title: e.title })),
            deps.launchMusic(),
          )
        : { consulted: true, entries: {} }
      if (answer.consulted)
        for (const e of asked) answered.set(answerKey(e.id, e.title), answer.entries[e.id] ?? [])
      lookup = answer.consulted
        ? {
            consulted: true,
            entries: Object.fromEntries(
              entries.flatMap((e) => {
                const found = answered.get(answerKey(e.id, e.title)) ?? []
                return found.length ? [[e.id, found]] : []
              }),
            ),
          }
        : answer
      return {
        entries: entries.map((e) => {
          const dateAdded = only(e.id)?.dateAdded
          return dateAdded ? { ...e, dateAdded } : e
        }),
        skipped: read.skipped,
        seratoLeftOut: read.seratoLeftOut,
        musicConsulted: lookup.consulted,
        ...found,
      }
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
        titles: Object.fromEntries(fixes.map((f) => [f.id, titles.get(f.id) ?? f.id])),
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
      forget(removals.flatMap((r) => [r.removeId, r.keepId]))
      const replaced: DuplicateReplaceOutcome[] = await window.api
        .removeListDuplicates(
          removals.map((r) => {
            const ref = musicOf(r.removeId, r.keepId)
            return { from: r.removeId, to: r.keepId, label: r.label, ...(ref && { music: ref }) }
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
        ? window.api.setMusicField(
            outcome.musicId,
            fix.field,
            fix.to,
            fix.from,
            ...(outcome.path ? [outcome.path] : []),
          )
        : undefined,
    inMusic: (id) => music(id).length > 0,
    musicConsulted: () => lookup?.consulted,
    facts: (id) => {
      const rows = deps.rows()
      if (snapshot?.rows !== rows) {
        const byPath = new Map<string, TrackItem>()
        for (const row of rows) if (!byPath.has(row.inputPath)) byPath.set(row.inputPath, row)
        snapshot = { rows, byPath }
      }
      return snapshot.byPath.get(id)
    },
    loadDamage: () =>
      window.api.scanDamage(
        listReviewEntries(reviewable())
          .entries.map((e) => e.id)
          .filter((path) => !gone.has(path)),
      ),
    repairDamage: (items) => window.api.repairDamage(items),
    settle: (updates, trashed) => {
      forget(updates.map((u) => u.path))
      changes.push(...updates)
      for (const path of trashed) gone.add(path)
      if (trashed.length) deps.onRowsRemoved(trashed)
    },
  }
}
