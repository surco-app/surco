import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import { groupByTab, searchSettings } from './settingsSearch'
import { SETTINGS_SEARCH_INDEX, type SettingsSearchEntry } from './settingsSearchIndex'

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

describe('the shipped index', () => {
  const enT = (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en)
    return typeof value === 'string' ? value : key
  }
  const ids = (q: string) => searchSettings(q, SETTINGS_SEARCH_INDEX, enT).map((h) => h.entry.id)

  it.each([
    ['bitrate', 'mp3Quality'],
    ['kHz', 'sampleRate'],
    ['dark', 'theme'],
    ['LUFS', 'normalize.title'],
    ['iCloud', 'configDir'],
  ])(
    'finds a setting by the word a DJ would type (%s) even when the label says it otherwise',
    (q, id) => {
      expect(ids(q)).toContain(id)
    },
  )

  it('finds a tab with no labelled settings by its name', () => {
    expect(ids('shortcuts')).toContain('tabs.shortcuts')
  })

  it('only keeps synonyms for settings the index has, so none is translated in vain', () => {
    const synonymIds = Object.keys(
      (en.settings as Record<string, unknown>).searchSynonyms as Record<string, unknown>,
    )
    const indexIds = new Set(SETTINGS_SEARCH_INDEX.map((e) => e.id.split('.')[0]))
    expect(synonymIds.filter((id) => !indexIds.has(id))).toEqual([])
  })
})
