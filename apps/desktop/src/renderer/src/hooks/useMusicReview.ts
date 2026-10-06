import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MusicFixOutcome, MusicReviewEntry, RemoveCopyResult } from '../../../shared/types'
import { type DuplicateGroup, duplicateGroups } from '../lib/duplicates'
import { tagUpdatesOf } from '../lib/libraryTagUpdates'
import { planFixes, summarizeFixes } from '../lib/musicFixPlan'
import { type SpellingGroup, spellingGroups } from '../lib/musicSpelling'

export type ReviewFilter = 'all' | 'spelling' | 'duplicates'

export interface DuplicateCard {
  group: DuplicateGroup
  entries: MusicReviewEntry[]
  formats: Record<string, string>
}

export interface ReviewRun {
  outcomes: MusicFixOutcome[]
  removed: RemoveCopyResult[]
  before: number
  after: number
}

export interface MusicReview {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'applying' | 'done'
  filter: ReviewFilter
  setFilter: (f: ReviewFilter) => void
  spelling: SpellingGroup[]
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
}

const LOSSLESS = ['AIFF', 'AIF', 'WAV', 'FLAC', 'M4A']
const FAILED_REMOVAL: RemoveCopyResult = { outcome: 'failed', playlists: 0, fileTrashed: false }

const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toUpperCase()
const toItem = (e: MusicReviewEntry) => ({
  id: e.persistentId,
  artist: e.artist,
  title: e.title,
  durationSec: e.durationSec,
})
const labelOf = (e: MusicReviewEntry) => `${e.artist} - ${e.title}`

// Two clusters of one recording share a key; staging and choices are keyed by it, so the
// later ones get the first member's id appended.
function uniqueKeys(groups: DuplicateGroup[]): DuplicateGroup[] {
  const seen = new Set<string>()
  return groups.map((g) => {
    const key = seen.has(g.key) ? `${g.key}#${g.ids[0]}` : g.key
    seen.add(g.key)
    return key === g.key ? g : { ...g, key }
  })
}

function pendingCount(entries: MusicReviewEntry[], ignored: ReadonlySet<string>): number {
  const spelling = spellingGroups(entries).filter((g) => !ignored.has(g.key)).length
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
  onFilesChanged: (paths: string[]) => void
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
    () => spellingGroups(entries).filter((g) => !hidden.has(g.key)),
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
      return d.ids.find((id) => LOSSLESS.includes(formats[id] ?? '')) ?? d.ids[0]
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
              other.field === added.field &&
              other.variants.some((v) => values.has(v.value))
            )
              next.delete(other.key)
        }
        next.add(key)
        return next
      })
    },
    [choice, spelling],
  )

  const ignore = useCallback(
    (key: string) => {
      const next = new Set(hidden).add(key)
      setHidden(next)
      saveIgnored([...next])
      setStaged((s) => {
        const copy = new Set(s)
        copy.delete(key)
        return copy
      })
    },
    [hidden, saveIgnored],
  )

  const fixes = useMemo(
    () =>
      planFixes(
        entries,
        spelling
          .filter((g) => staged.has(g.key))
          .map((group) => ({ group, to: choice(group.key) as string })),
      ),
    [entries, spelling, staged, choice],
  )

  const removals = useMemo(
    () =>
      dupGroups
        .filter((g) => staged.has(g.key))
        .flatMap((g) => {
          const keepPid = choice(g.key) as string
          const keep = byPid.get(keepPid)
          return g.ids.flatMap((removePid) => {
            const removed = byPid.get(removePid)
            if (removePid === keepPid || !removed || !keep) return []
            return [{ removePid, keepPid, label: labelOf(removed), keepLabel: labelOf(keep) }]
          })
        }),
    [dupGroups, staged, choice, byPid],
  )

  const summary = useMemo(
    () => ({ ...summarizeFixes(fixes), duplicates: removals.length }),
    [fixes, removals],
  )

  const apply = useCallback(async () => {
    if (running.current) return
    running.current = true
    setStatus('applying')
    const before = pendingCount(entries, hidden)
    const off = window.api.onMusicFixProgress(setProgress)
    try {
      const outcomes = fixes.length ? await window.api.applyMusicFixes(fixes) : []
      const removed: RemoveCopyResult[] = []
      for (const r of removals)
        removed.push(await window.api.removeMusicDuplicate(r).catch(() => FAILED_REMOVAL))
      const written = outcomes.flatMap((o) => (o.file === 'written' && o.path ? [o.path] : []))
      const updates = tagUpdatesOf(outcomes, 'apply')
      if (updates.length) await window.api.syncLibraryTags(updates).catch(() => undefined)
      const next = await load()
      setStaged(new Set())
      setChoices({})
      setLastRun({ outcomes, removed, before, after: pendingCount(next, hidden) })
      if (written.length) onFilesChanged(written)
    } finally {
      off()
      setProgress(null)
      running.current = false
      setStatus('done')
    }
  }, [entries, hidden, fixes, removals, load, onFilesChanged])

  const cancel = useCallback(() => {
    void window.api.cancelMusicFixes()
  }, [])

  const undo = useCallback(async () => {
    if (running.current || !lastRun) return
    running.current = true
    setStatus('applying')
    try {
      const paths: string[] = []
      for (const o of lastRun.outcomes) {
        if (o.backupId) {
          await window.api.trashRestore(o.backupId)
          if (o.path) paths.push(o.path)
        }
        for (const [i, f] of o.fixes.entries())
          if (o.music[i] === 'set')
            await window.api.setMusicField(f.persistentId, f.field, f.to, f.from)
      }
      const updates = tagUpdatesOf(lastRun.outcomes, 'undo')
      if (updates.length) await window.api.syncLibraryTags(updates).catch(() => undefined)
      await load()
      setLastRun(null)
      if (paths.length) onFilesChanged(paths)
    } finally {
      running.current = false
      setStatus('ready')
    }
  }, [lastRun, load, onFilesChanged])

  return {
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
  }
}
