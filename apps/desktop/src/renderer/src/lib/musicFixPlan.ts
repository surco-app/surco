import type { MusicFieldFix, MusicReviewEntry, MusicReviewField } from '../../../shared/types'
import { replaceAct, type SpellingGroup } from './musicSpelling'

export interface GroupChoice {
  group: SpellingGroup
  to: string
}

const ACT_FIELDS: ReadonlySet<MusicReviewField> = new Set(['artist', 'albumArtist'])

export function planFixes(entries: MusicReviewEntry[], choices: GroupChoice[]): MusicFieldFix[] {
  const byPid = new Map(entries.map((entry) => [entry.persistentId, entry]))
  const next = new Map<string, { persistentId: string; field: MusicReviewField; value: string }>()
  for (const { group, to } of choices) {
    for (const variant of group.variants) {
      if (variant.value === to) continue
      for (const persistentId of variant.persistentIds) {
        const entry = byPid.get(persistentId)
        if (!entry) continue
        const key = `${persistentId}|${group.field}`
        // Several choices can touch one credit; each must build on the previous result.
        const before = next.get(key)?.value ?? entry[group.field]
        const after = ACT_FIELDS.has(group.field)
          ? replaceAct(before, variant.value, to)
          : before === variant.value
            ? to
            : before
        next.set(key, { persistentId, field: group.field, value: after })
      }
    }
  }
  const fixes: MusicFieldFix[] = []
  for (const { persistentId, field, value } of next.values()) {
    const from = (byPid.get(persistentId) as MusicReviewEntry)[field]
    if (from !== value) fixes.push({ persistentId, field, from, to: value })
  }
  return fixes
}

export function summarizeFixes(fixes: MusicFieldFix[]): {
  tracks: number
  byField: Partial<Record<MusicReviewField, number>>
} {
  const byField: Partial<Record<MusicReviewField, number>> = {}
  for (const fix of fixes) byField[fix.field] = (byField[fix.field] ?? 0) + 1
  return { tracks: new Set(fixes.map((f) => f.persistentId)).size, byField }
}
