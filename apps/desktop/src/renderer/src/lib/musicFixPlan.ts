import type { MusicReviewField, ReviewEntry, ReviewFix } from '../../../shared/types'
import { replaceAct, type SpellingGroup } from './musicSpelling'

export interface GroupChoice {
  group: SpellingGroup
  to: string
}

const ACT_FIELDS: ReadonlySet<MusicReviewField> = new Set(['artist', 'albumArtist'])

export function planFixes(entries: ReviewEntry[], choices: GroupChoice[]): ReviewFix[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const next = new Map<string, { id: string; field: MusicReviewField; value: string }>()
  for (const { group, to } of choices) {
    for (const variant of group.variants) {
      if (variant.value === to) continue
      for (const id of variant.ids) {
        const entry = byId.get(id)
        if (!entry) continue
        const key = `${id}|${group.field}`
        // Several choices can touch one credit; each must build on the previous result.
        const before = next.get(key)?.value ?? entry[group.field]
        const after = ACT_FIELDS.has(group.field)
          ? replaceAct(before, variant.value, to)
          : before === variant.value
            ? to
            : before
        next.set(key, { id, field: group.field, value: after })
      }
    }
  }
  const fixes: ReviewFix[] = []
  for (const { id, field, value } of next.values()) {
    const from = (byId.get(id) as ReviewEntry)[field]
    if (from !== value) fixes.push({ id, field, from, to: value })
  }
  return fixes
}

export function summarizeFixes(fixes: ReviewFix[]): {
  tracks: number
  byField: Partial<Record<MusicReviewField, number>>
} {
  const byField: Partial<Record<MusicReviewField, number>> = {}
  for (const fix of fixes) byField[fix.field] = (byField[fix.field] ?? 0) + 1
  return { tracks: new Set(fixes.map((f) => f.id)).size, byField }
}
