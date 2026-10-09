import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DuplicateReplaceOutcome,
  LibraryStatus,
  LibraryTagSyncReport,
  LibraryTagUpdate,
  MusicReviewField,
  RemoveCopyResult,
  ReviewEntry,
  ReviewFix,
  ReviewOutcome,
} from '../../../shared/types'
import { copyQuality, qualityRank } from '../lib/copyQuality'
import { type DuplicateGroup, duplicateGroups } from '../lib/duplicates'
import { libraryUpdatesOf, tagUpdatesOf } from '../lib/libraryTagUpdates'
import { prefersReducedMotion } from '../lib/motion'
import { planFixes, summarizeFixes } from '../lib/musicFixPlan'
import {
  type SpellingGroup,
  type SpellingKind,
  type SpellingVariant,
  spellingGroups,
  suggest,
} from '../lib/musicSpelling'
import {
  musicSource,
  type ReviewRemoval,
  type ReviewRemovalRun,
  type ReviewSource,
} from '../lib/reviewSource'
import type { TrackItem } from '../types'

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
  entries: ReviewEntry[]
  formats: Record<string, string>
  locations: Record<string, string>
}

export interface ReviewRun {
  outcomes: ReviewOutcome[]
  removed: RemoveCopyResult[]
  replaced: DuplicateReplaceOutcome[]
  // The run was stopped with removed copies the libraries never heard about.
  librariesUntouched?: boolean
  before: number
  after: number | null
  librarySync: 'ok' | 'failed' | 'none'
  // Each library's own answer to the tag sync; absent when nothing was sent or the call
  // itself failed.
  tagSync?: LibraryTagSyncReport
  applyError?: string
  undoFailures?: number
  // What an undo sent the libraries when one was open or failed: the next Undo sends it again.
  libraryUndo?: LibraryTagUpdate[]
}

export type ReviewPhase =
  | { name: 'writing' | 'duplicates' | 'restoring'; current: number; total: number }
  | { name: 'libraries' | 'verifying' | 'checking-music' }

// How long the bar takes to fill (TopProgressBar's transition), waited out before the
// result opens so the bar never jumps from part way to gone. Reduced motion has no fill to
// wait for: the bar jumps.
const FILL_MS = 300

export interface MusicReview {
  kind: ReviewSource['kind']
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
  undoing: boolean
  apply: () => Promise<void>
  cancel: () => void
  undo: () => Promise<void>
  lastRun: ReviewRun | null
  // Null until main answers; a library that is on but not found is the case it exists for.
  libraries: LibraryStatus | null
  affected: (key: string) => (ReviewFix & { title: string })[]
  reviewed: number
  // Rows the list could not review because their file was not read.
  skipped: number
  musicConsulted?: boolean
  inMusic: (id: string) => boolean
  facts: (id: string) => TrackItem | undefined
}

const RANK = ['AIFF', 'AIF', 'WAV', 'FLAC', 'M4A']
const rankOf = (format: string) => {
  const i = RANK.indexOf(format)
  return i < 0 ? 2 : i < 4 ? 0 : 1
}

const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toUpperCase()
const toItem = (e: ReviewEntry) => ({
  id: e.id,
  artist: e.artist,
  title: e.title,
  durationSec: e.durationSec,
})
const keepsNoFile = (ids: string[], keepPid: string, locations: Record<string, string>) =>
  locations[keepPid] === '' && ids.some((id) => locations[id])

const labelOf = (e: ReviewEntry) => `${e.artist} - ${e.title}`

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
      for (const id of v.ids) set.add(id)
    }
  const variants = [...ids]
    .map(([value, set]) => ({ value, ids: [...set].sort() }))
    .sort((a, b) => b.ids.length - a.ids.length || a.value.localeCompare(b.value))
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

function pending(
  spelling: SpellingGroup[],
  duplicates: DuplicateGroup[],
  ignored: ReadonlySet<string>,
  touches: (ids: string[]) => boolean = () => true,
) {
  return {
    spelling: mergeSpelling(spelling.filter((g) => !ignored.has(g.key))).filter((g) =>
      g.parts.some((p) => p.variants.some((v) => touches(v.ids))),
    ).length,
    duplicates: duplicates.filter(
      (g) => g.kind === 'duplicate' && !ignored.has(g.key) && touches(g.ids),
    ).length,
  }
}

function pendingCount(
  spelling: SpellingGroup[],
  duplicates: DuplicateGroup[],
  ignored: ReadonlySet<string>,
): number {
  const counts = pending(spelling, duplicates, ignored)
  return counts.spelling + counts.duplicates
}

const groupsOf = (entries: ReviewEntry[]) =>
  [spellingGroups(entries), uniqueKeys(duplicateGroups(entries.map(toItem)))] as const

export function pendingGroups(
  entries: ReviewEntry[],
  ignored: readonly string[],
  touching: ReadonlySet<string>,
) {
  return pending(...groupsOf(entries), new Set(ignored), (ids) =>
    ids.some((id) => touching.has(id)),
  )
}

export function useMusicReview({
  source = musicSource,
  initialFilter,
  ignored,
  saveIgnored,
  onFilesChanged,
}: {
  source?: ReviewSource
  initialFilter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (updates: LibraryTagUpdate[]) => void
}): MusicReview {
  const [status, setStatus] = useState<MusicReview['status']>('loading')
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [staged, setStaged] = useState<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(Array.isArray(ignored) ? ignored : []),
  )
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<MusicReview['progress']>(null)
  const [phase, setPhase] = useState<ReviewPhase | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [lastRun, setLastRun] = useState<ReviewRun | null>(null)
  const running = useRef(false)
  const cancelled = useRef(false)

  const [libraries, setLibraries] = useState<LibraryStatus | null>(null)
  const [loaded, setLoaded] = useState<{ skipped: number; musicConsulted?: boolean }>({
    skipped: 0,
  })

  const load = useCallback(async () => {
    window.api.libraryStatus().then(setLibraries, () => {})
    // A failed reload leaves the source's Music answer reset; the scope line follows it.
    const consulted = (fallback?: boolean) => source.musicConsulted?.() ?? fallback
    const result = await source.load().catch((error) => {
      setLoaded((l) => ({ ...l, musicConsulted: consulted(l.musicConsulted) }))
      throw error
    })
    setEntries(result.entries)
    setLoaded({ skipped: result.skipped, musicConsulted: consulted(result.musicConsulted) })
    return result.entries
  }, [source])

  const inMusic = useCallback(
    (id: string) => source.inMusic?.(id) ?? source.kind === 'music',
    [source],
  )
  const facts = useCallback((id: string) => source.facts?.(id), [source])

  useEffect(() => {
    load().then(
      (next) => setStatus(next.length === 0 ? 'empty' : 'ready'),
      () => setStatus('error'),
    )
  }, [load])

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const allSpelling = useMemo(() => spellingGroups(entries), [entries])
  const allDuplicates = useMemo(() => uniqueKeys(duplicateGroups(entries.map(toItem))), [entries])
  const spelling = useMemo(
    () => mergeSpelling(allSpelling.filter((g) => !hidden.has(g.key))),
    [allSpelling, hidden],
  )
  const dupGroups = useMemo(
    () => allDuplicates.filter((g) => !hidden.has(g.key)),
    [allDuplicates, hidden],
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
    Promise.allSettled(missing.map((id) => source.locate(id))).then((results) => {
      for (const pid of missing) inFlight.current.delete(pid)
      const found = results.flatMap((r, i) =>
        r.status === 'fulfilled' ? [[missing[i], r.value] as const] : [],
      )
      if (found.length) setLocations((l) => ({ ...l, ...Object.fromEntries(found) }))
      if (found.length < missing.length) setRetry((n) => n + 1)
    })
  }, [dupGroups, locations, retry, source])

  const formats = useMemo(
    () => Object.fromEntries(Object.entries(locations).map(([pid, path]) => [pid, extOf(path)])),
    [locations],
  )

  const duplicates = useMemo<DuplicateCard[]>(
    () =>
      dupGroups.map((group) => ({
        group,
        entries: group.ids.flatMap((id) => byId.get(id) ?? []),
        formats: Object.fromEntries(
          group.ids.filter((id) => id in formats).map((id) => [id, formats[id]]),
        ),
        locations: Object.fromEntries(
          group.ids.filter((id) => id in locations).map((id) => [id, locations[id]]),
        ),
      })),
    [dupGroups, byId, formats, locations],
  )

  const choice = useCallback(
    (key: string): string | null => {
      const d = dupGroups.find((g) => g.key === key)
      if (choices[key] && !(d && keepsNoFile(d.ids, choices[key], locations))) return choices[key]
      const s = spelling.find((g) => g.key === key)
      if (s) return s.suggested
      if (!d) return null
      const withFile = d.ids.filter((id) => locations[id] !== '')
      const better = (a: string, b: string) =>
        rankOf(formats[a] ?? '') - rankOf(formats[b] ?? '') ||
        qualityRank(copyQuality(facts(a))) - qualityRank(copyQuality(facts(b)))
      return (withFile.length ? withFile : d.ids).reduce((best, id) =>
        better(id, best) < 0 ? id : best,
      )
    },
    [choices, spelling, dupGroups, formats, locations, facts],
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

  const removals = useMemo<ReviewRemoval[]>(
    () =>
      dupGroups
        .filter((g) => staged.has(g.key))
        .flatMap((g) => {
          const keepId = choice(g.key) as string
          const keep = byId.get(keepId)
          if (!g.ids.includes(keepId)) return []
          return g.ids.flatMap((removeId) => {
            const removed = byId.get(removeId)
            if (removeId === keepId || !removed || !keep) return []
            return [{ removeId, keepId, label: labelOf(removed), keepLabel: labelOf(keep) }]
          })
        }),
    [dupGroups, staged, choice, byId],
  )

  const fixes = useMemo(() => {
    const removing = new Set(removals.map((r) => r.removeId))
    return planFixes(
      entries.filter((e) => !removing.has(e.id)),
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
      ).map((fix) => ({ ...fix, title: byId.get(fix.id)?.title ?? '' }))
    },
    [spelling, choice, entries, byId],
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
    const before = pendingCount(allSpelling, allDuplicates, hidden)
    const writes = new Set(fixes.map((f) => f.id)).size
    const total = writes + removals.length
    setProgress({ done: 0, total })
    setPhase(
      writes
        ? { name: 'writing', current: 1, total: writes }
        : { name: 'duplicates', current: 1, total: removals.length },
    )
    const off = source.onProgress((p) => {
      setProgress({ done: p.done, total })
      setPhase({ name: 'writing', current: p.current, total: p.total })
    })
    try {
      let outcomes: ReviewOutcome[] = []
      let applyError: string | undefined
      if (fixes.length)
        try {
          outcomes = await source.applyFixes(fixes)
        } catch (error) {
          applyError = error instanceof Error ? error.message : String(error)
        }
      let librariesPhase = false
      let removal: ReviewRemovalRun = {
        removed: [],
        replaced: [],
        librariesUntouched: false,
        replaceFailed: false,
      }
      if (applyError === undefined && removals.length)
        removal = await source.removeCopies(removals, {
          isCancelled: () => cancelled.current,
          onStep: (current) => setPhase({ name: 'duplicates', current, total: removals.length }),
          onDone: (done) => setProgress({ done: writes + done, total }),
          onLibraries: () => {
            librariesPhase = true
            setPhase({ name: 'libraries' })
          },
          onCheckingMusic: () => setPhase({ name: 'checking-music' }),
        })
      const { removed, replaced } = removal
      const updates = libraryUpdatesOf(outcomes, 'apply')
      if (updates.length && !librariesPhase) setPhase({ name: 'libraries' })
      let librarySync: ReviewRun['librarySync'] = removal.replaceFailed ? 'failed' : 'none'
      let tagSync: LibraryTagSyncReport | undefined
      if (updates.length) {
        const synced = await window.api.syncLibraryTags(updates).then(
          (report) => {
            tagSync = report
            return 'ok' as const
          },
          () => 'failed' as const,
        )
        if (librarySync !== 'failed') librarySync = synced
      }
      const changedFiles = tagUpdatesOf(outcomes, 'apply')
      const trashed = replaced.filter((r) => r.fileTrashed).map((r) => r.from)
      if (changedFiles.length || trashed.length) source.settle?.(changedFiles, trashed)
      if (changedFiles.length) onFilesChanged(changedFiles)
      setPhase({ name: 'verifying' })
      const next = await load().catch(() => null)
      setStaged(new Set())
      setChoices({})
      setLastRun({
        outcomes,
        removed,
        replaced,
        ...(removal.librariesUntouched ? { librariesUntouched: true } : {}),
        before,
        after: next ? pendingCount(...groupsOf(next), hidden) : null,
        librarySync,
        ...(tagSync ? { tagSync } : {}),
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
  }, [allSpelling, allDuplicates, hidden, fixes, removals, load, onFilesChanged, fill, source])

  const cancel = useCallback(() => {
    cancelled.current = true
    source.cancel()
  }, [source])

  const undo = useCallback(async () => {
    if (running.current || !lastRun) return
    running.current = true
    setUndoing(true)
    setStatus('applying')
    const total = lastRun.outcomes.length
    setProgress({ done: 0, total })
    setPhase({ name: 'restoring', current: 1, total })
    try {
      const restored: ReviewOutcome[] = []
      const reverted: ReviewOutcome[] = []
      const failed: ReviewOutcome[] = []
      for (const [i, o] of lastRun.outcomes.entries()) {
        setPhase({ name: 'restoring', current: i + 1, total })
        setProgress({ done: i, total })
        if (o.file === 'written' && !o.backupId) {
          failed.push(o)
          continue
        }
        if (o.backupId) {
          try {
            await window.api.trashRestore(o.backupId)
            restored.push(o)
          } catch {
            failed.push(o)
            continue
          }
        }
        // A field goes back in the libraries only once whatever it followed went back: Music
        // when Music took it, else the file just restored. A 'mismatch' or 'missing' left
        // Music as it was, and the libraries stay with it.
        const music = [...o.music]
        const back: MusicReviewField[] = []
        for (const [i, f] of o.fixes.entries()) {
          if (o.music[i] !== 'set') {
            if (o.backupId && o.written.includes(f.field)) back.push(f.field)
            continue
          }
          const answer = await source.revertMusic(o, f).catch(() => 'failed' as const)
          if (answer !== 'set') continue
          music[i] = 'none'
          back.push(f.field)
        }
        reverted.push({ ...o, music: o.music.map(() => 'none'), written: back })
        // The file is back already: a retry only owes Music the fields it refused.
        if (music.includes('set'))
          failed.push({ ...o, music, backupId: undefined, file: 'unchanged' })
      }
      const updates = [...(lastRun.libraryUndo ?? []), ...libraryUpdatesOf(reverted, 'undo')]
      let librarySync: ReviewRun['librarySync'] = 'none'
      let tagSync: LibraryTagSyncReport | undefined
      if (updates.length) setPhase({ name: 'libraries' })
      if (updates.length)
        librarySync = await window.api.syncLibraryTags(updates).then(
          (report) => {
            tagSync = report
            return 'ok' as const
          },
          () => 'failed' as const,
        )
      const back = tagUpdatesOf(restored, 'undo')
      if (back.length) source.settle?.(back, [])
      if (back.length) onFilesChanged(back)
      setPhase({ name: 'verifying' })
      await load().catch(() => null)
      const libraryLeft =
        librarySync === 'failed' ||
        Object.values(tagSync ?? {}).some((s) => s.outcome === 'failed' || s.outcome === 'open')
      setLastRun(
        failed.length === 0 && !libraryLeft
          ? null
          : {
              ...lastRun,
              outcomes: failed,
              removed: [],
              replaced: [],
              librarySync,
              tagSync,
              undoFailures: failed.length,
              libraryUndo: libraryLeft ? updates : [],
            },
      )
      await fill(total)
    } finally {
      setProgress(null)
      setPhase(null)
      setUndoing(false)
      running.current = false
      setStatus('ready')
    }
  }, [lastRun, load, onFilesChanged, fill, source])

  // Stable between renders because the provider keeps it in state: a fresh object each
  // render would set that state again and never settle.
  return useMemo(
    () => ({
      kind: source.kind,
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
      undoing,
      apply,
      cancel,
      undo,
      lastRun,
      libraries,
      affected,
      reviewed: entries.length,
      skipped: loaded.skipped,
      musicConsulted: loaded.musicConsulted,
      inMusic,
      facts,
    }),
    [
      source.kind,
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
      undoing,
      apply,
      cancel,
      undo,
      lastRun,
      libraries,
      affected,
      entries.length,
      loaded,
      inMusic,
      facts,
    ],
  )
}
