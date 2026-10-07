import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LibraryTagUpdate,
  MusicFieldFix,
  MusicFixOutcome,
  MusicReviewEntry,
  MusicReviewField,
  RemoveCopyResult,
} from '../../../shared/types'
import { type DuplicateGroup, duplicateGroups } from '../lib/duplicates'
import { tagUpdatesOf } from '../lib/libraryTagUpdates'
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
}

export interface ReviewRun {
  outcomes: MusicFixOutcome[]
  removed: RemoveCopyResult[]
  before: number
  after: number | null
  librarySync: 'ok' | 'failed' | 'none'
  applyError?: string
  undoFailures?: number
}

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
  apply: () => Promise<void>
  cancel: () => void
  undo: () => Promise<void>
  lastRun: ReviewRun | null
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

const signature = (g: SpellingGroup) =>
  [g.kind, ...g.variants.map((v) => v.value).sort()].join('\u0000')

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
// user decides it once, so both fields show as one group in the place of the first.
export function mergeSpelling(groups: SpellingGroup[]): ReviewSpellingGroup[] {
  const albumArtist = new Map<string, SpellingGroup>()
  for (const g of groups)
    if (g.field === 'albumArtist' && !albumArtist.has(signature(g)))
      albumArtist.set(signature(g), g)
  const paired = new Map<SpellingGroup, SpellingGroup>()
  for (const g of groups) {
    if (g.field !== 'artist') continue
    const partner = albumArtist.get(signature(g))
    if (!partner) continue
    albumArtist.delete(signature(g))
    paired.set(g, partner)
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
  const [formats, setFormats] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<MusicReview['progress']>(null)
  const [lastRun, setLastRun] = useState<ReviewRun | null>(null)
  const running = useRef(false)
  const cancelled = useRef(false)

  const load = useCallback(async () => {
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

  useEffect(() => {
    const missing = [...new Set(dupGroups.flatMap((g) => g.ids))].filter((pid) => !(pid in formats))
    if (missing.length === 0) return
    let live = true
    Promise.all(
      missing.map(
        async (pid) =>
          [pid, extOf(await window.api.appleMusicEntryLocation(pid).catch(() => ''))] as const,
      ),
    ).then((pairs) => live && setFormats((f) => ({ ...f, ...Object.fromEntries(pairs) })))
    return () => {
      live = false
    }
  }, [dupGroups, formats])

  const duplicates = useMemo<DuplicateCard[]>(
    () =>
      dupGroups.map((group) => ({
        group,
        entries: group.ids.flatMap((id) => byPid.get(id) ?? []),
        formats: Object.fromEntries(
          group.ids.filter((id) => id in formats).map((id) => [id, formats[id]]),
        ),
      })),
    [dupGroups, byPid, formats],
  )

  const choice = useCallback(
    (key: string): string | null => {
      if (choices[key]) return choices[key]
      const s = spelling.find((g) => g.key === key)
      if (s) return s.suggested
      const d = dupGroups.find((g) => g.key === key)
      if (!d) return null
      return d.ids.reduce((best, id) =>
        rankOf(formats[id] ?? '') < rankOf(formats[best] ?? '') ? id : best,
      )
    },
    [choices, spelling, dupGroups, formats],
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
        if (dup) {
          for (const other of dupGroups)
            if (other.key !== key && other.ids.some((id) => dup.ids.includes(id)))
              next.delete(other.key)
        }
        next.add(key)
        return next
      })
    },
    [choice, spelling, dupGroups],
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

  const apply = useCallback(async () => {
    if (running.current) return
    running.current = true
    cancelled.current = false
    setStatus('applying')
    const before = pendingCount(entries, hidden)
    const off = window.api.onMusicFixProgress(setProgress)
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
        removed.push(await window.api.removeMusicDuplicate(r).catch(() => FAILED_REMOVAL))
      }
      const updates = tagUpdatesOf(outcomes, 'apply')
      let librarySync: ReviewRun['librarySync'] = 'none'
      if (updates.length)
        librarySync = await window.api.syncLibraryTags(updates).then(
          () => 'ok' as const,
          () => 'failed' as const,
        )
      if (updates.length) onFilesChanged(updates)
      const next = await load().catch(() => null)
      setStaged(new Set())
      setChoices({})
      setLastRun({
        outcomes,
        removed,
        before,
        after: next ? pendingCount(next, hidden) : null,
        librarySync,
        ...(applyError === undefined ? {} : { applyError }),
      })
    } finally {
      off()
      setProgress(null)
      running.current = false
      setStatus('done')
    }
  }, [entries, hidden, fixes, removals, load, onFilesChanged])

  const cancel = useCallback(() => {
    cancelled.current = true
    void window.api.cancelMusicFixes()
  }, [])

  const undo = useCallback(async () => {
    if (running.current || !lastRun) return
    running.current = true
    setStatus('applying')
    try {
      const restored: MusicFixOutcome[] = []
      const reverted: MusicFixOutcome[] = []
      const failed: MusicFixOutcome[] = []
      for (const o of lastRun.outcomes) {
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
      if (updates.length)
        librarySync = await window.api.syncLibraryTags(updates).then(
          () => 'ok' as const,
          () => 'failed' as const,
        )
      const back = tagUpdatesOf(restored, 'undo')
      if (back.length) onFilesChanged(back)
      await load().catch(() => null)
      setLastRun(
        failed.length === 0 && librarySync !== 'failed'
          ? null
          : { ...lastRun, outcomes: failed, librarySync, undoFailures: failed.length },
      )
    } finally {
      running.current = false
      setStatus('ready')
    }
  }, [lastRun, load, onFilesChanged])

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
      apply,
      cancel,
      undo,
      lastRun,
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
      apply,
      cancel,
      undo,
      lastRun,
      affected,
    ],
  )
}
