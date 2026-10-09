import type { MusicReviewField, ReviewEntry } from '../../../shared/types'

export type SpellingKind = 'invisible' | 'case' | 'punctuation' | 'typo'

export interface SpellingVariant {
  value: string
  ids: string[]
}

export interface SpellingGroup {
  key: string
  field: MusicReviewField
  kind: SpellingKind
  variants: SpellingVariant[]
  suggested: string | null
}

export const SAFE_KINDS: ReadonlySet<SpellingKind> = new Set(['invisible', 'case', 'punctuation'])

export const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g
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

// The typo rule only ever asks "one edit or none" (Damerau, so swapping two neighbours is
// one). Answering that in one pass instead of filling the whole table took grouping 5000
// tracks from 1.45 s to a tenth of that.
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    )
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

const digitsOf = (key: string) => key.replace(/\D/g, '')

export const spellingCost = { editChecks: 0 }

// Measured on a real library: below 8 letters or at distance 2, almost every pair was two different artists.
const MIN_TYPO_LENGTH = 8
const ACT_TITLE = /^(?:dj|mc)\s+(?=\S)/i

interface Cluster {
  key: string
  bare: string | null
  keyDigits: string
  bareDigits: string | null
}

function bareKey(value: string): string | null {
  return ACT_TITLE.test(value) ? punctuationKey(value.replace(ACT_TITLE, '')) : null
}

// Names after DJ or MC are short and differ by one letter between real people (DJ Napo, DJ Nano).
function isClusterTypo(a: Cluster, b: Cluster): boolean {
  return a.bare !== null && b.bare !== null
    ? isTypoPair(a.bare, b.bare, a.bareDigits as string, b.bareDigits as string)
    : isTypoPair(a.key, b.key, a.keyDigits, b.keyDigits)
}

function isTypoPair(a: string, b: string, aDigits: string, bDigits: string): boolean {
  if (Math.min(a.length, b.length) < MIN_TYPO_LENGTH) return false
  if (aDigits !== bDigits) return false
  spellingCost.editChecks += 1
  return withinOneEdit(a, b)
}

function mixedCase(value: string): boolean {
  return value !== value.toUpperCase() && value !== value.toLowerCase()
}

export function suggest(variants: SpellingVariant[]): string | null {
  const candidates = variants.filter((v) => isClean(v.value))
  if (candidates.length === 0) return clean(variants[0].value)
  const top = candidates[0].ids.length
  const tied = candidates.filter((v) => v.ids.length === top)
  if (tied.length === 1) return tied[0].value
  const mixed = tied.filter((v) => mixedCase(v.value))
  return mixed.length === 1 ? mixed[0].value : null
}

type Bucket = Map<string, Map<string, Set<string>>>

function valuesOf(entry: ReviewEntry, field: MusicReviewField): { scope: string; value: string }[] {
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

function collect(entries: ReviewEntry[], field: MusicReviewField): Map<string, Bucket> {
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
      ids.add(entry.id)
    }
  }
  return scopes
}

function variantsOf(...clusters: Map<string, Set<string>>[]): SpellingVariant[] {
  return clusters
    .flatMap((c) => [...c].map(([value, ids]) => ({ value, ids: [...ids].sort() })))
    .sort((a, b) => b.ids.length - a.ids.length || a.value.localeCompare(b.value))
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

function representative(variants: SpellingVariant[]): SpellingVariant {
  const suggested = suggest(variants)
  return variants.find((v) => v.value === suggested) ?? variants[0]
}

function typoGroups(field: MusicReviewField, scope: string, clusters: Bucket): SpellingGroup[] {
  const keys = [...clusters.keys()]
  const reps = new Map(
    keys.map((k) => [k, representative(variantsOf(clusters.get(k) as Map<string, Set<string>>))]),
  )
  const info = new Map<string, Cluster>(
    keys.map((k) => {
      const bare = bareKey((reps.get(k) as SpellingVariant).value)
      return [
        k,
        { key: k, bare, keyDigits: digitsOf(k), bareDigits: bare === null ? null : digitsOf(bare) },
      ]
    }),
  )
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
    for (let len = a.length; len <= a.length + 1; len++) {
      for (const b of byLength.get(len) ?? []) {
        if (b <= a && len === a.length) continue
        if (isClusterTypo(info.get(a) as Cluster, info.get(b) as Cluster))
          parent.set(find(a), find(b))
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
      const variants = members
        .map((k) => reps.get(k) as SpellingVariant)
        .sort((a, b) => b.ids.length - a.ids.length || a.value.localeCompare(b.value))
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

export function spellingGroups(entries: ReviewEntry[]): SpellingGroup[] {
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
      if (field !== 'title' && field !== 'genre') groups.push(...typoGroups(field, scope, clusters))
    }
  }
  const tracks = (g: SpellingGroup) => g.variants.reduce((n, v) => n + v.ids.length, 0)
  return groups.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || tracks(b) - tracks(a),
  )
}
