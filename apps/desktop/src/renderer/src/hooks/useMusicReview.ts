import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DuplicateReplaceOutcome,
  LibraryStatus,
  LibraryTagUpdate,
  MusicFieldFix,
  MusicFixOutcome,
  MusicReviewEntry,
  MusicReviewField,
  RemoveCopyResult,
} from '../../../shared/types'
import { type DuplicateGroup, duplicateGroups } from '../lib/duplicates'
import { tagUpdatesOf } from '../lib/libraryTagUpdates'
import { prefersReducedMotion } from '../lib/motion'
import { planFixes, summarizeFixes } from '../lib/musicFixPlan'
import {
  type SpellingGroup,
  type SpellingKind,
  type SpellingVariant,
  spellingGroups,
  suggest,
} from '../lib/musicSpelling'

export type ReviewFilter = 'all' | 'spelling' | 'duplicates'

export interface ReviewSpellingGroup {
  key: string
  fields: MusicReviewField[]
  kind: SpellingKind
  variants: SpellingVariant[]
  suggested: string | null
  parts: SpellingGroup[]
}

export interface DuplicateCard {
  group: DuplicateGroup
  entries: MusicReviewEntry[]
  formats: Record<string, string>
  locations: Record<string, string>
}

export interface ReviewRun {
  outcomes: MusicFixOutcome[]
  removed: RemoveCopyResult[]
  replaced: DuplicateReplaceOutcome[]
  // The run was stopped with removed copies the libraries never heard about.
  librariesUntouched?: boolean
  before: number
  after: number | null
  librarySync: 'ok' | 'failed' | 'none'
  applyError?: string
  undoFailures?: number
}

export type ReviewPhase =
  | { name: 'writing' | 'duplicates' | 'restoring'; current: number; total: number }
  | { name: 'libraries' | 'verifying' }

// How long the bar takes to fill (TopProgressBar's transition), waited out before the
// result opens so the bar never jumps from part way to gone. Reduced motion has no fill to
// wait for: the bar jumps.
const FILL_MS = 300

export interface MusicReview {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'applying' | 'done'
  filter: ReviewFilter
  setFilter: (f: ReviewFilter) => void
  spelling: ReviewSpellingGroup[]
  duplicates: DuplicateCard[]
  choice: (key: string) => string | null
  choose: (key: string, value: string) => void
  staged: ReadonlySet<string>
  toggleStaged: (key: string) => void
  ignore: (key: string) => void
  summary: {
    tracks: number
    byField: ReturnType<typeof summarizeFixes>['byField']
    duplicates: number
  }
  progress: { done: number; total: number } | null
  phase: ReviewPhase | null
  apply: () => Promise<void>
  cancel: () => void
  undo: () => Promise<void>
  lastRun: ReviewRun | null
  // Null until main answers; a library that is on but not found is the case it exists for.
  libraries: LibraryStatus | null
  affected: (key: string) => (MusicFieldFix & { title: string })[]
}

const RANK = ['AIFF', 'AIF', 'WAV', 'FLAC', 'M4A']
const rankOf = (format: string) => {
  const i = RANK.indexOf(format)
  return i < 0 ? 2 : i < 4 ? 0 : 1
}
const FAILED_REMOVAL: RemoveCopyResult = { outcome: 'failed', playlists: 0, fileTrashed: false }

const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toUpperCase()
const toItem = (e: MusicReviewEntry) => ({
  id: e.persistentId,
  artist: e.artist,
  title: e.title,
  durationSec: e.durationSec,
})
const labelOf = (e: MusicReviewEntry) => `${e.artist} - ${e.title}`

// Keyed by the smallest member so an ignore survives a reload and removing one cluster
// never renames its sibling that shares the recording key.
function uniqueKeys(groups: DuplicateGroup[]): DuplicateGroup[] {
  return groups.map((g) =>
    g.kind === 'duplicate' ? { ...g, key: `${g.key}#${[...g.ids].sort()[0]}` } : g,
  )
}

const single = (g: SpellingGroup): ReviewSpellingGroup => ({
  key: g.key,
  fields: [g.field],
  kind: g.kind,
  variants: g.variants,
  suggested: g.suggested,
  parts: [g],
})

function joined(parts: SpellingGroup[]): ReviewSpellingGroup {
  const ids = new Map<string, Set<string>>()
  for (const part of parts)
    for (const v of part.variants) {
      const set = ids.get(v.value) ?? new Set<string>()
      ids.set(v.value, set)
      for (const id of v.persistentIds) set.add(id)
    }
  const variants = [...ids]
    .map(([value, set]) => ({ value, persistentIds: [...set].sort() }))
    .sort(
      (a, b) => b.persistentIds.length - a.persistentIds.length || a.value.localeCompare(b.value),
    )
  const suggestions = new Set(parts.map((p) => p.suggested))
  return {
    key: parts
      .map((p) => p.key)
      .sort()
      .join('+'),
    fields: parts.map((p) => p.field),
    kind: parts[0].kind,
    variants,
    suggested: suggestions.size === 1 ? parts[0].suggested : suggest(variants),
    parts,
  }
}

// A credit misspelled as artist is usually misspelled the same way as album artist; the
// user decides it once, so both fields show as one group in the place of the first. The
// fields need not hold the same set of spellings: one shared spelling makes it one name.
export function mergeSpelling(groups: SpellingGroup[]): ReviewSpellingGroup[] {
  const albumArtist = groups.filter((g) => g.field === 'albumArtist')
  const paired = new Map<SpellingGroup, SpellingGroup>()
  for (const g of groups) {
    if (g.field !== 'artist') continue
    const values = new Set(g.variants.map((v) => v.value))
    const at = albumArtist.findIndex(
      (a) => a.kind === g.kind && a.variants.some((v) => values.has(v.value)),
    )
    if (at < 0) continue
    paired.set(g, albumArtist[at])
    albumArtist.splice(at, 1)
  }
  const taken = new Set(paired.values())
  return groups.flatMap((g) => {
    if (taken.has(g)) return []
    const partner = paired.get(g)
    return [partner ? joined([g, partner]) : single(g)]
  })
}

function pendingCount(entries: MusicReviewEntry[], ignored: ReadonlySet<string>): number {
  const spelling = mergeSpelling(spellingGroups(entries).filter((g) => !ignored.has(g.key))).length
  const dups = uniqueKeys(duplicateGroups(entries.map(toItem))).filter(
    (g) => g.kind === 'duplicate' && !ignored.has(g.key),
  ).length
  return spelling + dups
}

export function useMusicReview({
  initialFilter,
  ignored,
  saveIgnored,
  onFilesChanged,
}: {
  initialFilter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (updates: LibraryTagUpdate[]) => void
}): MusicReview {
  const [status, setStatus] = useState<MusicReview['status']>('loading')
  const [entries, setEntries] = useState<MusicReviewEntry[]>([])
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [staged, setStaged] = useState<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(Array.isArray(ignored) ? ignored : []),
  )
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<MusicReview['progress']>(null)
  const [phase, setPhase] = useState<ReviewPhase | null>(null)
  const [lastRun, setLastRun] = useState<ReviewRun | null>(null)
  const running = useRef(false)
  const cancelled = useRef(false)

  const [libraries, setLibraries] = useState<LibraryStatus | null>(null)

  const load = useCallback(async () => {
    window.api.libraryStatus().then(setLibraries, () => {})
    const next = await window.api.loadMusicReview()
    setEntries(next)
    return next
  }, [])

  useEffect(() => {
    load().then(
      (next) => setStatus(next.length === 0 ? 'empty' : 'ready'),
      () => setStatus('error'),
    )
  }, [load])

  const byPid = useMemo(() => new Map(entries.map((e) => [e.persistentId, e])), [entries])
  const spelling = useMemo(
    () => mergeSpelling(spellingGroups(entries).filter((g) => !hidden.has(g.key))),
    [entries, hidden],
  )
  const dupGroups = useMemo(
    () => uniqueKeys(duplicateGroups(entries.map(toItem))).filter((g) => !hidden.has(g.key)),
    [entries, hidden],
  )

  // A failed lookup is not "no file": it stays out of `locations` (unknown) and is tried
  // once more, so only an answer from Music can mark a copy as having no file.
  const attempts = useRef(new Map<string, number>())
  const inFlight = useRef(new Set<string>())
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    void retry
    const missing = [...new Set(dupGroups.flatMap((g) => g.ids))].filter(
      (pid) =>
        !(pid in locations) && !inFlight.current.has(pid) && (attempts.current.get(pid) ?? 0) < 2,
    )
    if (missing.length === 0) return
    for (const pid of missing) {
      attempts.current.set(pid, (attempts.current.get(pid) ?? 0) + 1)
      inFlight.current.add(pid)
    }
    Promise.allSettled(missing.map((pid) => window.api.appleMusicEntryLocation(pid))).then(
      (results) => {
        for (const pid of missing) inFlight.current.delete(pid)
        const found = results.flatMap((r, i) =>
          r.status === 'fulfilled' ? [[missing[i], r.value] as const] : [],
        )
        if (found.length) setLocations((l) => ({ ...l, ...Object.fromEntries(found) }))
        if (found.length < missing.length) setRetry((n) => n + 1)
      },
    )
  }, [dupGroups, locations, retry])

  const formats = useMemo(
    () => Object.fromEntries(Object.entries(locations).map(([pid, path]) => [pid, extOf(path)])),
    [locations],
  )

  const duplicates = useMemo<DuplicateCard[]>(
    () =>
      dupGroups.map((group) => ({
        group,
        entries: group.ids.flatMap((id) => byPid.get(id) ?? []),
        formats: Object.fromEntries(
          group.ids.filter((id) => id in formats).map((id) => [id, formats[id]]),
        ),
        locations: Object.fromEntries(
          group.ids.filter((id) => id in locations).map((id) => [id, locations[id]]),
        ),
      })),
    [dupGroups, byPid, formats, locations],
  )

  const choice = useCallback(
    (key: string): string | null => {
      if (choices[key]) return choices[key]
      const s = spelling.find((g) => g.key === key)
      if (s) return s.suggested
      const d = dupGroups.find((g) => g.key === key)
      if (!d) return null
      const withFile = d.ids.filter((id) => locations[id] !== '')
      return (withFile.length ? withFile : d.ids).reduce((best, id) =>
        rankOf(formats[id] ?? '') < rankOf(formats[best] ?? '') ? id : best,
      )
    },
    [choices, spelling, dupGroups, formats, locations],
  )

  const choose = useCallback(
    (key: string, value: string) => setChoices((c) => ({ ...c, [key]: value })),
    [],
  )

  const toggleStaged = useCallback(
    (key: string) => {
      if (!choice(key)) return
      setStaged((s) => {
        const next = new Set(s)
        if (next.delete(key)) return next
        const added = spelling.find((g) => g.key === key)
        if (added) {
          const values = new Set(added.variants.map((v) => v.value))
          for (const other of spelling)
            if (
              other.key !== key &&
              other.fields.some((f) => added.fields.includes(f)) &&
              other.variants.some((v) => values.has(v.value))
            )
              next.delete(other.key)
        }
        const dup = dupGroups.find((g) => g.key === key)
        if (dup?.ids.some((id) => !(id in locations))) return s
        if (dup) {
          for (const other of dupGroups)
            if (other.key !== key && other.ids.some((id) => dup.ids.includes(id)))
              next.delete(other.key)
        }
        next.add(key)
        return next
      })
    },
    [choice, spelling, dupGroups, locations],
  )

  const ignore = useCallback(
    (key: string) => {
      const next = new Set(hidden)
      for (const part of spelling.find((g) => g.key === key)?.parts ?? [{ key }]) next.add(part.key)
      setHidden(next)
      saveIgnored([...next])
      setStaged((s) => {
        const copy = new Set(s)
        copy.delete(key)
        return copy
      })
    },
    [hidden, saveIgnored, spelling],
  )

  const removals = useMemo(
    () =>
      dupGroups
        .filter((g) => staged.has(g.key))
        .flatMap((g) => {
          const keepPid = choice(g.key) as string
          const keep = byPid.get(keepPid)
          if (!g.ids.includes(keepPid)) return []
          return g.ids.flatMap((removePid) => {
            const removed = byPid.get(removePid)
            if (removePid === keepPid || !removed || !keep) return []
            return [{ removePid, keepPid, label: labelOf(removed), keepLabel: labelOf(keep) }]
          })
        }),
    [dupGroups, staged, choice, byPid],
  )

  const fixes = useMemo(() => {
    const removing = new Set(removals.map((r) => r.removePid))
    return planFixes(
      entries.filter((e) => !removing.has(e.persistentId)),
      spelling
        .filter((g) => staged.has(g.key))
        .flatMap((g) => g.parts.map((group) => ({ group, to: choice(g.key) as string }))),
    )
  }, [entries, removals, spelling, staged, choice])

  const affected = useCallback(
    (key: string) => {
      const group = spelling.find((g) => g.key === key)
      const to = choice(key)
      if (!group || to === null) return []
      return planFixes(
        entries,
        group.parts.map((part) => ({ group: part, to })),
      ).map((fix) => ({ ...fix, title: byPid.get(fix.persistentId)?.title ?? '' }))
    },
    [spelling, choice, entries, byPid],
  )

  const summary = useMemo(
    () => ({ ...summarizeFixes(fixes), duplicates: removals.length }),
    [fixes, removals],
  )

  const fill = useCallback(async (total: number) => {
    setProgress({ done: total, total })
    setPhase(null)
    if (!prefersReducedMotion()) await new Promise((resolve) => setTimeout(resolve, FILL_MS))
  }, [])

  const apply = useCallback(async () => {
    if (running.current) return
    running.current = true
    cancelled.current = false
    setStatus('applying')
    const before = pendingCount(entries, hidden)
    const writes = new Set(fixes.map((f) => f.persistentId)).size
    const total = writes + removals.length
    setProgress({ done: 0, total })
    setPhase(
      writes
        ? { name: 'writing', current: 1, total: writes }
        : { name: 'duplicates', current: 1, total: removals.length },
    )
    const off = window.api.onMusicFixProgress((p) => {
      setProgress({ done: p.done, total })
      setPhase({ name: 'writing', current: p.current, total: p.total })
    })
    try {
      let outcomes: MusicFixOutcome[] = []
      let applyError: string | undefined
      if (fixes.length)
        try {
          outcomes = await window.api.applyMusicFixes(fixes)
        } catch (error) {
          applyError = error instanceof Error ? error.message : String(error)
        }
      const removed: RemoveCopyResult[] = []
      for (const r of removals) {
        if (cancelled.current || applyError !== undefined) break
        setPhase({ name: 'duplicates', current: removed.length + 1, total: removals.length })
        removed.push(await window.api.removeMusicDuplicate(r).catch(() => FAILED_REMOVAL))
        setProgress({ done: writes + removed.length, total })
      }
      const pairs = removed.flatMap((r) => (r.pair ? [r.pair] : []))
      let replaced: DuplicateReplaceOutcome[] = []
      let replaceFailed = false
      let librariesCalled = false
      const updates = tagUpdatesOf(outcomes, 'apply')
      if ((pairs.length && !cancelled.current) || updates.length) setPhase({ name: 'libraries' })
      if (pairs.length && !cancelled.current) {
        librariesCalled = true
        replaced = await window.api.replaceDuplicatesInLibraries(pairs).catch(() => {
          replaceFailed = true
          return []
        })
      }
      let librarySync: ReviewRun['librarySync'] = replaceFailed ? 'failed' : 'none'
      if (updates.length) {
        const synced = await window.api.syncLibraryTags(updates).then(
          () => 'ok' as const,
          () => 'failed' as const,
        )
        if (librarySync !== 'failed') librarySync = synced
      }
      if (updates.length) onFilesChanged(updates)
      setPhase({ name: 'verifying' })
      const next = await load().catch(() => null)
      setStaged(new Set())
      setChoices({})
      setLastRun({
        outcomes,
        removed,
        replaced,
        ...(pairs.length && !librariesCalled ? { librariesUntouched: true } : {}),
        before,
        after: next ? pendingCount(next, hidden) : null,
        librarySync,
        ...(applyError === undefined ? {} : { applyError }),
      })
      if (!cancelled.current) await fill(total)
    } finally {
      off()
      setProgress(null)
      setPhase(null)
      running.current = false
      setStatus('done')
    }
  }, [entries, hidden, fixes, removals, load, onFilesChanged, fill])

  const cancel = useCallback(() => {
    cancelled.current = true
    void window.api.cancelMusicFixes()
  }, [])

  const undo = useCallback(async () => {
    if (running.current || !lastRun) return
    running.current = true
    setStatus('applying')
    const total = lastRun.outcomes.length
    setProgress({ done: 0, total })
    setPhase({ name: 'restoring', current: 1, total })
    try {
      const restored: MusicFixOutcome[] = []
      const reverted: MusicFixOutcome[] = []
      const failed: MusicFixOutcome[] = []
      for (const [i, o] of lastRun.outcomes.entries()) {
        setPhase({ name: 'restoring', current: i + 1, total })
        setProgress({ done: i, total })
        if (o.file === 'written' && !o.backupId) {
          failed.push(o)
          continue
        }
        let ok = true
        if (o.backupId) {
          try {
            await window.api.trashRestore(o.backupId)
            restored.push(o)
          } catch {
            failed.push(o)
            continue
          }
        }
        for (const [i, f] of o.fixes.entries())
          if (o.music[i] === 'set')
            await window.api.setMusicField(f.persistentId, f.field, f.to, f.from).catch(() => {
              ok = false
            })
        if (ok) reverted.push(o)
        // The file is back already: a retry only owes Music its value.
        else failed.push({ ...o, backupId: undefined, file: 'unchanged' })
      }
      const updates = tagUpdatesOf(reverted, 'undo')
      let librarySync: ReviewRun['librarySync'] = 'none'
      if (updates.length) setPhase({ name: 'libraries' })
      if (updates.length)
        librarySync = await window.api.syncLibraryTags(updates).then(
          () => 'ok' as const,
          () => 'failed' as const,
        )
      const back = tagUpdatesOf(restored, 'undo')
      if (back.length) onFilesChanged(back)
      setPhase({ name: 'verifying' })
      await load().catch(() => null)
      setLastRun(
        failed.length === 0 && librarySync !== 'failed'
          ? null
          : { ...lastRun, outcomes: failed, librarySync, undoFailures: failed.length },
      )
      await fill(total)
    } finally {
      setProgress(null)
      setPhase(null)
      running.current = false
      setStatus('ready')
    }
  }, [lastRun, load, onFilesChanged, fill])

  // Stable between renders because the provider keeps it in state: a fresh object each
  // render would set that state again and never settle.
  return useMemo(
    () => ({
      status,
      filter,
      setFilter,
      spelling,
      duplicates,
      choice,
      choose,
      staged,
      toggleStaged,
      ignore,
      summary,
      progress,
      phase,
      apply,
      cancel,
      undo,
      lastRun,
      libraries,
      affected,
    }),
    [
      status,
      filter,
      spelling,
      duplicates,
      choice,
      choose,
      staged,
      toggleStaged,
      ignore,
      summary,
      progress,
      phase,
      apply,
      cancel,
      undo,
      lastRun,
      libraries,
      affected,
    ],
  )
}
