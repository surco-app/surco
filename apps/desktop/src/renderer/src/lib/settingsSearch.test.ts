import { describe, expect, it } from 'vitest'
import { groupByTab, searchSettings } from './settingsSearch'
import type { SettingsSearchEntry } from './settingsSearchIndex'

const dict: Record<string, string> = {
  'settings.traktorSync': 'Traktor collection',
  'settings.mp3Quality': 'MP3 quality',
  'settings.searchSynonyms.mp3Quality': 'bitrate, kbps',
  'settings.theme': 'Apariencia',
  'settings.language': 'Música',
}
const t = (k: string): string => dict[k] ?? k

const index: SettingsSearchEntry[] = [
  { id: 'mp3Quality', tab: 'conversion', label: 'settings.mp3Quality' },
  { id: 'traktorSync', tab: 'destination', label: 'settings.traktorSync' },
  { id: 'theme', tab: 'general', label: 'settings.theme' },
  { id: 'language', tab: 'general', label: 'settings.language' },
]

describe('searchSettings', () => {
  it('finds a setting by any part of its label, ignoring case, so a DJ can type the app name as they think of it', () => {
    const hits = searchSettings('TRAKTOR', index, t)
    expect(hits.map((h) => h.entry.id)).toEqual(['traktorSync'])
    expect(hits[0].text).toBe('Traktor collection')
    expect(hits[0].ranges).toEqual([[0, 7]])
    expect(hits[0].synonym).toBeNull()
  })

  it('ignores accents on both sides, since users type without them', () => {
    const musica = searchSettings('musica', index, t)
    expect(musica.map((h) => h.entry.id)).toEqual(['language'])
    expect(musica[0].ranges).toEqual([[0, 6]])
    expect(searchSettings('apariéncia', index, t).map((h) => h.entry.id)).toEqual(['theme'])
  })

  it('finds a setting through a synonym when the label uses other words', () => {
    const hits = searchSettings('bitrate', index, t)
    expect(hits.map((h) => h.entry.id)).toEqual(['mp3Quality'])
    expect(hits[0].synonym).toBe('bitrate')
    expect(hits[0].ranges).toEqual([])
  })

  it('lists label matches before synonym-only matches', () => {
    const withSynonym = (k: string): string =>
      k === 'settings.searchSynonyms.traktorSync' ? 'mp3 export' : t(k)
    const reordered: SettingsSearchEntry[] = [index[1], index[0]]
    expect(searchSettings('mp3', reordered, withSynonym).map((h) => h.entry.id)).toEqual([
      'mp3Quality',
      'traktorSync',
    ])
  })

  it('returns nothing for an empty or whitespace-only query, so the tabs stay', () => {
    expect(searchSettings('', index, t)).toEqual([])
    expect(searchSettings('   ', index, t)).toEqual([])
  })
})

describe('groupByTab', () => {
  it('groups hits by tab in sidebar order', () => {
    const groups = groupByTab(searchSettings('a', index, t))
    expect(groups.map((g) => g.tab)).toEqual(['general', 'conversion', 'destination'])
    expect(groups[0].hits.map((h) => h.entry.id)).toEqual(['theme', 'language'])
  })
})
