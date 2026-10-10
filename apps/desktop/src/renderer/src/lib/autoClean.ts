import type { MusicReviewField, ReviewEntry } from '../../../shared/types'
import type { FieldCleanup, TrackItem } from '../types'
import { diskMeta, listReviewEntries } from './listReviewEntries'
import { clean, INVISIBLE, replaceAct, type SpellingVariant, spellingGroups } from './musicSpelling'

const FIELDS: MusicReviewField[] = ['title', 'artist', 'albumArtist', 'album', 'genre']
const ACT_FIELDS: ReadonlySet<MusicReviewField> = new Set(['artist', 'albumArtist'])

export const CLEAR_MAJORITY_MIN_TRACKS = 3
export const CLEAR_MAJORITY_RATIO = 2

export interface AutoCleanOptions {
  targets: ReadonlySet<string>
  spacing: boolean
  unifyCase: boolean
  ignored: readonly string[]
  editing: string | null
}

export interface CleanFix extends Omit<FieldCleanup, 'undone'> {
  id: string
  field: MusicReviewField
}

export type CleanReason = 'leading' | 'trailing' | 'inner' | 'invisible' | 'case'

function clearWinner(variants: SpellingVariant[]): string | null {
  const [top, ...rest] = [...variants].sort((a, b) => b.ids.length - a.ids.length)
  if (top.ids.length < CLEAR_MAJORITY_MIN_TRACKS) return null
  return rest.every((v) => v.ids.length * CLEAR_MAJORITY_RATIO <= top.ids.length) ? top.value : null
}

function withFields(entry: ReviewEntry, fix: (value: string) => string): ReviewEntry {
  const next = { ...entry }
  for (const field of FIELDS) next[field] = fix(entry[field])
  return next
}

function ignoredCells(entries: ReviewEntry[], ignored: ReadonlySet<string>): Set<string> {
  const cells = new Set<string>()
  for (const g of spellingGroups(entries)) {
    if ((g.kind !== 'invisible' && g.kind !== 'case') || !ignored.has(g.key)) continue
    for (const v of g.variants) for (const id of v.ids) cells.add(`${g.field}|${id}`)
  }
  return cells
}

function unifiedCase(
  entries: ReviewEntry[],
  ignored: ReadonlySet<string>,
): Map<string, ReviewEntry> {
  const byId = new Map(entries.map((e) => [e.id, e]))
  for (const g of spellingGroups(entries)) {
    if (g.kind !== 'case' || ignored.has(g.key)) continue
    const winner = clearWinner(g.variants)
    if (winner === null) continue
    for (const v of g.variants) {
      if (v.value === winner) continue
      for (const id of v.ids) {
        const entry = byId.get(id) as ReviewEntry
        const before = entry[g.field]
        const after = ACT_FIELDS.has(g.field)
          ? replaceAct(before, v.value, winner)
          : before === v.value
            ? winner
            : before
        byId.set(id, { ...entry, [g.field]: after })
      }
    }
  }
  return byId
}

export function planAutoClean(rows: TrackItem[], options: AutoCleanOptions): CleanFix[] {
  const { targets, spacing, unifyCase, editing } = options
  if (!spacing && !unifyCase) return []
  const ignored = new Set(options.ignored)
  const raw = listReviewEntries(rows).entries
  const blocked = ignoredCells(raw, ignored)
  const base = raw.map((e) => withFields(e, spacing ? clean : (v) => v.trim()))
  const result = unifyCase ? unifiedCase(base, ignored) : new Map(base.map((e) => [e.id, e]))
  const rawById = new Map(raw.map((e) => [e.id, e]))
  const fixes: CleanFix[] = []
  for (const row of rows) {
    if (!targets.has(row.inputPath) || row.id === editing) continue
    const entry = rawById.get(row.inputPath)
    const disk = diskMeta(row)
    const next = result.get(row.inputPath)
    if (!entry || !disk || !next) continue
    for (const field of FIELDS) {
      const from = entry[field]
      const to = next[field]
      if (to === (spacing ? from : from.trim())) continue
      if (blocked.has(`${field}|${row.inputPath}`) || row.cleaned?.[field]) continue
      const before = disk[field] ?? ''
      if ((row.meta[field] ?? '') !== before) continue
      fixes.push({ id: row.id, field, raw: from, before, to })
    }
  }
  return fixes
}

export function applyAutoClean(tracks: TrackItem[], fixes: CleanFix[]): TrackItem[] {
  if (fixes.length === 0) return tracks
  const byId = new Map<string, CleanFix[]>()
  for (const fix of fixes) byId.set(fix.id, [...(byId.get(fix.id) ?? []), fix])
  return tracks.map((t) => {
    let next = t
    for (const { field, raw, before, to } of byId.get(t.id) ?? []) {
      if ((next.meta[field] ?? '') !== before || next.cleaned?.[field]) continue
      next = {
        ...next,
        meta: { ...next.meta, [field]: to },
        cleaned: { ...next.cleaned, [field]: { raw, before, to } },
      }
    }
    return next
  })
}

export function activeCleanups(track: TrackItem): MusicReviewField[] {
  return FIELDS.filter((field) => {
    const record = track.cleaned?.[field]
    return !!record && !record.undone && (track.meta[field] ?? '') === record.to
  })
}

export function undoCleanup(track: TrackItem, field: MusicReviewField): Partial<TrackItem> | null {
  if (!activeCleanups(track).includes(field)) return null
  const record = track.cleaned?.[field] as FieldCleanup
  return {
    meta: { ...track.meta, [field]: record.before },
    cleaned: { ...track.cleaned, [field]: { ...record, undone: true } },
  }
}

export function cleanReasons(raw: string, to: string): { reason: CleanReason; count: number }[] {
  const visible = raw.replace(INVISIBLE, '')
  const leading = visible.length - visible.trimStart().length
  const trailing = visible.length - visible.trimEnd().length
  const inner = (visible.trim().match(/\s+/g) ?? []).filter((run) => run !== ' ').length
  const invisible = raw.match(INVISIBLE)?.length ?? 0
  const counts: [CleanReason, number][] = [
    ['leading', leading],
    ['trailing', trailing],
    ['inner', inner],
    ['invisible', invisible],
    ['case', clean(raw) === to ? 0 : 1],
  ]
  return counts.filter(([, count]) => count > 0).map(([reason, count]) => ({ reason, count }))
}
