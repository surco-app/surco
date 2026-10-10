import { describe, expect, it } from 'vitest'
import appEn from '../../../desktop/src/renderer/src/i18n/locales/en.json'
import appEs from '../../../desktop/src/renderer/src/i18n/locales/es.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import {
  matchesUseCase,
  USE_CASE_SOURCES,
  USE_CASE_SOURCES_BY_CASE,
  type UseCaseSource,
} from './useCases'

type Setting = { tab: string; section?: string; setting: string; value?: string }
type Case = { id: string; group: string; settings: Setting[] }
type Group = { id: string }

function strings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj]
  if (obj && typeof obj === 'object') return Object.values(obj).flatMap(strings)
  return []
}

function cases(locale: unknown): Case[] {
  return (locale as { useCases?: { cases?: Case[] } }).useCases?.cases ?? []
}

function groups(locale: unknown): Group[] {
  return (locale as { useCases?: { groups?: Group[] } }).useCases?.groups ?? []
}

// Each use case is a recipe a reader follows with the app open beside it, clicking
// Settings → tab → option by name. If the app renames a tab or an option, the recipe
// sends people hunting for a word that no longer exists, and the readers this page is
// for are exactly the ones who give up at that point.
describe('use case settings name what the app shows', () => {
  for (const [name, web, app] of [
    ['es', es, appEs],
    ['en', en, appEn],
  ] as const) {
    const tabs = Object.values(app.settings.tabs)
    const labels = strings(app)

    it(`${name} points at settings tabs that exist`, () => {
      const settings = cases(web).flatMap((c) => c.settings)
      expect(settings.length).toBeGreaterThan(0)
      expect(settings.map((s) => s.tab).filter((tab) => !tabs.includes(tab))).toEqual([])
    })

    it(`${name} uses the app's own words for every section, option and value`, () => {
      const words = cases(web)
        .flatMap((c) => c.settings)
        .flatMap((s) => [s.section, s.setting, s.value])
        .filter((w): w is string => Boolean(w))
      expect(words.filter((w) => !labels.includes(w))).toEqual([])
    })
  }

  it('gives every case the same anchor in both languages', () => {
    expect(cases(en).map((c) => c.id)).toEqual(cases(es).map((c) => c.id))
  })

  // The index is built from the groups, so a recipe filed under a group the page does not
  // define never appears in it: the reader scanning the index would not know it exists.
  it('files every case under a group the page defines', () => {
    for (const locale of [es, en]) {
      const ids = groups(locale).map((g) => g.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(cases(locale).filter((c) => !ids.includes(c.group))).toEqual([])
    }
  })

  it('gives both languages the same groups in the same order', () => {
    expect(groups(en).map((g) => g.id)).toEqual(groups(es).map((g) => g.id))
    expect(cases(en).map((c) => c.group)).toEqual(cases(es).map((c) => c.group))
  })
})

type Findable = { id: string; title: string; body: string[]; keywords: string }

function findable(locale: unknown): Findable[] {
  return (locale as { useCases: { cases: Findable[] } }).useCases.cases
}

function found(locale: unknown, query: string, source: UseCaseSource | null = null): string[] {
  return findable(locale)
    .filter((c) => matchesUseCase(c, query, source))
    .map((c) => c.id)
}

// People land here with a word in mind ("duplicados", "cue points", "USB"), not with our
// titles. If typing that word does not surface the recipe, the page looks like it does not
// cover the job and they leave.
describe('finding a use case', () => {
  it('finds a recipe by a word that only its keywords carry', () => {
    expect(found(es, 'duplicados')).toEqual(['duplicates'])
    expect(found(en, 'duplicates')).toEqual(['duplicates'])
  })

  it('ignores accents and capitals, since nobody types them in a search box', () => {
    expect(found(es, 'CARATULA')).toContain('in-place')
    expect(found(es, 'vinilo')).toEqual(found(es, 'vínilo'))
  })

  it('matches the start of words, so a short word does not light up unrelated recipes', () => {
    expect(found(es, 'nas')).toEqual(['nas'])
    expect(found(en, 'nas')).toEqual(['nas'])
  })

  it('needs every word typed to match', () => {
    expect(found(es, 'apple duplicados')).toEqual(['duplicates'])
    expect(found(es, 'vinilo usb')).toEqual([])
  })

  it('shows everything with an empty query and no source picked', () => {
    expect(found(es, '  ')).toHaveLength(findable(es).length)
  })

  it('narrows to the recipes for where the music lives', () => {
    expect(found(es, '', 'engineDj')).toEqual(['engine-dj'])
    expect(found(es, '', 'usb')).toEqual(['usb', 'music-playlist-set'])
  })

  // A recipe with no source is invisible as soon as the reader picks one, and a source
  // with no recipe is a filter that always answers "nothing here".
  it('gives every case a source and every source a case', () => {
    expect(findable(es).filter((c) => !(USE_CASE_SOURCES_BY_CASE[c.id]?.length > 0))).toEqual([])
    for (const source of USE_CASE_SOURCES) expect(found(es, '', source).length).toBeGreaterThan(0)
  })

  it('names every source in both languages', () => {
    for (const locale of [es, en]) {
      const labels = (locale.useCases as { sources: Record<string, string> }).sources
      expect(USE_CASE_SOURCES.filter((s) => !labels[s])).toEqual([])
    }
  })
})
