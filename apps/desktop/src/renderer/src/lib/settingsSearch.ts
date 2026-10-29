import type { SettingsSearchEntry } from './settingsSearchIndex'
import { SETTINGS_TABS, type SettingsTab } from './settingsTabs'

export interface SettingsSearchHit {
  entry: SettingsSearchEntry
  text: string
  ranges: [number, number][]
  synonym: string | null
}

function fold(s: string): string {
  return [...s]
    .map((c) => c.normalize('NFD').replace(/\p{M}/gu, '')[0] ?? c)
    .join('')
    .toLowerCase()
}

function synonymsOf(entry: SettingsSearchEntry, t: (key: string) => string): string[] {
  const key = `settings.searchSynonyms.${entry.id}`
  const value = t(key)
  if (value === key) return []
  return value
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
}

export function searchSettings(
  query: string,
  index: SettingsSearchEntry[],
  t: (key: string) => string,
): SettingsSearchHit[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const byLabel: SettingsSearchHit[] = []
  const bySynonym: SettingsSearchHit[] = []
  for (const entry of index) {
    const text = t(entry.label)
    const at = fold(text).indexOf(needle)
    if (at !== -1) {
      byLabel.push({ entry, text, ranges: [[at, at + needle.length]], synonym: null })
      continue
    }
    const synonym = synonymsOf(entry, t).find((w) => fold(w).includes(needle))
    if (synonym) bySynonym.push({ entry, text, ranges: [], synonym })
  }
  return [...byLabel, ...bySynonym]
}

export function groupByTab(
  hits: SettingsSearchHit[],
): { tab: SettingsTab; hits: SettingsSearchHit[] }[] {
  return SETTINGS_TABS.map((tab) => ({
    tab,
    hits: hits.filter((h) => h.entry.tab === tab),
  })).filter((g) => g.hits.length > 0)
}
