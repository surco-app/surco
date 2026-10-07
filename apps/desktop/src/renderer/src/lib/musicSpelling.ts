import type { MusicReviewEntry, MusicReviewField } from '../../../shared/types'

export type SpellingKind = 'invisible' | 'case' | 'punctuation' | 'typo'

export interface SpellingVariant {
  value: string
  persistentIds: string[]
}

export interface SpellingGroup {
  key: string
  field: MusicReviewField
  kind: SpellingKind
  variants: SpellingVariant[]
  suggested: string | null
}

export const SAFE_KINDS: ReadonlySet<SpellingKind> = new Set(['invisible', 'case', 'punctuation'])

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g
const ACT_SEPARATOR = /(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|vs\.?|pres\.?)\s+|\s+x\s+)/i
const MULTI_VALUE = /[,;/]/
const KIND_ORDER: SpellingKind[] = ['invisible', 'case', 'punctuation', 'typo']

export function splitActs(value: string): string[] {
  return value
    .split(ACT_SEPARATOR)
    .filter((_, i) => i % 2 === 0)
    .map((act) => act.trim())
    .filter(Boolean)
}

export function replaceAct(value: string, from: string, to: string): string {
  return value
    .split(ACT_SEPARATOR)
    .map((part, i) => (i % 2 === 0 && part.trim() === from ? part.replace(from, () => to) : part))
    .join('')
}

function clean(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

function isClean(value: string): boolean {
  return clean(value) === value
}

function caseKey(value: string): string {
  return clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function punctuationKey(value: string): string {
  return caseKey(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = row
  }
  return prev[b.length]
}

function isTypoPair(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length)
  if (shorter < 5) return false
  if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false
  const limit = shorter < 9 ? 1 : 2
  return distance(a, b, limit) <= limit
}

function mixedCase(value: string): boolean {
  return value !== value.toUpperCase() && value !== value.toLowerCase()
}

export function suggest(variants: SpellingVariant[]): string | null {
  const candidates = variants.filter((v) => isClean(v.value))
  if (candidates.length === 0) return clean(variants[0].value)
  const top = candidates[0].persistentIds.length
  const tied = candidates.filter((v) => v.persistentIds.length === top)
  if (tied.length === 1) return tied[0].value
  const mixed = tied.filter((v) => mixedCase(v.value))
  return mixed.length === 1 ? mixed[0].value : null
}

type Bucket = Map<string, Map<string, Set<string>>>

function valuesOf(
  entry: MusicReviewEntry,
  field: MusicReviewField,
): { scope: string; value: string }[] {
  switch (field) {
    case 'artist':
    case 'albumArtist':
      return splitActs(entry[field]).map((value) => ({ scope: '', value }))
    case 'album':
      return entry.album
        ? [{ scope: punctuationKey(entry.albumArtist || entry.artist), value: entry.album }]
        : []
    case 'genre':
      return entry.genre && !MULTI_VALUE.test(entry.genre)
        ? [{ scope: '', value: entry.genre }]
        : []
    case 'title':
      return entry.title && !isClean(entry.title) ? [{ scope: '', value: entry.title }] : []
  }
}

function collect(entries: MusicReviewEntry[], field: MusicReviewField): Map<string, Bucket> {
  const scopes = new Map<string, Bucket>()
  for (const entry of entries) {
    for (const { scope, value } of valuesOf(entry, field)) {
      const clusters = scopes.get(scope) ?? new Map()
      scopes.set(scope, clusters)
      const key = punctuationKey(value)
      if (!key) continue
      const exact = clusters.get(key) ?? new Map<string, Set<string>>()
      clusters.set(key, exact)
      const ids = exact.get(value) ?? new Set<string>()
      exact.set(value, ids)
      ids.add(entry.persistentId)
    }
  }
  return scopes
}

function variantsOf(...clusters: Map<string, Set<string>>[]): SpellingVariant[] {
  return clusters
    .flatMap((c) => [...c].map(([value, ids]) => ({ value, persistentIds: [...ids].sort() })))
    .sort(
      (a, b) => b.persistentIds.length - a.persistentIds.length || a.value.localeCompare(b.value),
    )
}

function groupKey(
  field: MusicReviewField,
  scope: string,
  keys: string[],
  kind: SpellingKind,
): string {
  return [field, scope, kind, ...[...keys].sort()].join('|')
}

function kindOf(variants: SpellingVariant[]): SpellingKind {
  if (variants.some((v) => !isClean(v.value))) return 'invisible'
  return new Set(variants.map((v) => caseKey(v.value))).size === 1 ? 'case' : 'punctuation'
}

function typoGroups(field: MusicReviewField, scope: string, clusters: Bucket): SpellingGroup[] {
  const keys = [...clusters.keys()]
  const parent = new Map(keys.map((k) => [k, k]))
  const find = (k: string): string => {
    const p = parent.get(k) as string
    if (p === k) return k
    const root = find(p)
    parent.set(k, root)
    return root
  }
  const byLength = new Map<number, string[]>()
  for (const k of keys) {
    const same = byLength.get(k.length) ?? []
    same.push(k)
    byLength.set(k.length, same)
  }
  for (const a of keys) {
    for (let len = a.length; len <= a.length + 2; len++) {
      for (const b of byLength.get(len) ?? []) {
        if (b <= a && len === a.length) continue
        if (isTypoPair(a, b)) parent.set(find(a), find(b))
      }
    }
  }
  const sets = new Map<string, string[]>()
  for (const k of keys) {
    const root = find(k)
    const members = sets.get(root) ?? []
    members.push(k)
    sets.set(root, members)
  }
  return [...sets.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const variants = variantsOf(
        ...members.map((k) => clusters.get(k) as Map<string, Set<string>>),
      )
      return {
        key: groupKey(field, scope, members, 'typo'),
        field,
        kind: 'typo' as const,
        variants,
        suggested: suggest(variants),
      }
    })
}

const FIELDS: MusicReviewField[] = ['artist', 'albumArtist', 'album', 'genre', 'title']

export function spellingGroups(entries: MusicReviewEntry[]): SpellingGroup[] {
  const groups: SpellingGroup[] = []
  for (const field of FIELDS) {
    for (const [scope, clusters] of collect(entries, field)) {
      for (const [key, exact] of clusters) {
        const variants = variantsOf(exact)
        if (variants.length < 2 && isClean(variants[0].value)) continue
        const kind = kindOf(variants)
        groups.push({
          key: groupKey(field, scope, [key], kind),
          field,
          kind,
          variants,
          suggested: suggest(variants),
        })
      }
      if (field !== 'title') groups.push(...typoGroups(field, scope, clusters))
    }
  }
  const tracks = (g: SpellingGroup) => g.variants.reduce((n, v) => n + v.persistentIds.length, 0)
  return groups.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || tracks(b) - tracks(a),
  )
}
