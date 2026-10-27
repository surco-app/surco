import { describe, expect, it } from 'vitest'
import appEn from '../../../desktop/src/renderer/src/i18n/locales/en.json'
import appEs from '../../../desktop/src/renderer/src/i18n/locales/es.json'
import { spellingGroups } from '../../../desktop/src/renderer/src/lib/musicSpelling'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import ja from '../i18n/locales/ja.json'
import {
  filtersFromSearch,
  matchesUseCase,
  recipePages,
  recipePathForAnchor,
  searchForFilters,
  settingGroups,
  settingShot,
  USE_CASE_SHOTS,
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

  it('gives every case the same anchor in all languages', () => {
    expect(cases(en).map((c) => c.id)).toEqual(cases(es).map((c) => c.id))
    expect(cases(ja).map((c) => c.id)).toEqual(cases(en).map((c) => c.id))
  })

  // The index is built from the groups, so a recipe filed under a group the page does not
  // define never appears in it: the reader scanning the index would not know it exists.
  it('files every case under a group the page defines', () => {
    for (const locale of [es, en, ja]) {
      const ids = groups(locale).map((g) => g.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(cases(locale).filter((c) => !ids.includes(c.group))).toEqual([])
    }
  })

  it('gives all languages the same groups in the same order', () => {
    expect(groups(en).map((g) => g.id)).toEqual(groups(es).map((g) => g.id))
    expect(groups(ja).map((g) => g.id)).toEqual(groups(en).map((g) => g.id))
    expect(cases(en).map((c) => c.group)).toEqual(cases(es).map((c) => c.group))
    expect(cases(ja).map((c) => c.group)).toEqual(cases(en).map((c) => c.group))
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
  it('finds Japanese terms inside a sentence without broadening Latin prefixes', () => {
    const c = { id: 'nas', title: '音楽ファイルを整理する', body: [], keywords: 'music' }
    expect(matchesUseCase(c, 'ファイル', null)).toBe(true)
    expect(matchesUseCase(c, '整理', 'nas')).toBe(true)
    expect(matchesUseCase(c, '整理 music', null)).toBe(true)
    expect(matchesUseCase(c, '整理 不明', null)).toBe(false)
    expect(matchesUseCase(c, '整理', 'usb')).toBe(false)
    expect(matchesUseCase(c, 'usic', null)).toBe(false)
    expect(matchesUseCase({ ...c, title: 'カバーを変更する' }, 'カハー', null)).toBe(false)
    expect(matchesUseCase({ ...c, title: 'カバーを変更する' }, 'カバー', null)).toBe(true)
  })

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
    expect(found(es, '', 'nas')).toEqual(['nas'])
    expect(found(es, '', 'usb')).toEqual(['usb', 'music-playlist-set'])
  })

  // A recipe that only mentions a program in an optional setting still answers the question
  // its users ask: a rekordbox DJ moving to AIFF wants to know the cues survive, and an
  // Engine DJ user swapping in a better copy wants it to stay in the Engine playlists.
  it('lists a recipe under every program it keeps in sync', () => {
    expect(found(es, '', 'rekordbox')).toContain('to-aiff')
    expect(found(es, '', 'engineDj')).toContain('replace')
  })

  // A rekordbox DJ preparing a set looks for "hot cues" or "drop", with rekordbox picked as
  // where the music lives. The cue recipe only helps if it shows up for both.
  it('finds the cue recipe the way a rekordbox DJ looks for it', () => {
    expect(found(es, 'hot cues', 'rekordbox')).toEqual(['rekordbox-cues'])
    expect(found(en, 'hot cues', 'rekordbox')).toEqual(['rekordbox-cues'])
    expect(found(es, 'drop')).toEqual(['rekordbox-cues'])
    expect(found(en, 'drop')).toEqual(['rekordbox-cues'])
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

// Each recipe is its own page so it can be indexed, shared and linked from a support
// reply on its own. A slug that is missing, malformed or shared by two recipes either
// breaks the build or silently serves one recipe under another's address.
describe('use case pages', () => {
  for (const [name, locale] of [
    ['es', es],
    ['en', en],
  ] as const) {
    it(`${name} gives every recipe its own url-safe slug`, () => {
      const slugs = (locale.useCases.cases as { slug?: string }[]).map((c) => c.slug ?? '')
      expect(slugs.filter((s) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s))).toEqual([])
      expect(new Set(slugs).size).toBe(slugs.length)
    })
  }

  it('puts every recipe under the use cases page of its language', () => {
    const pages = recipePages()
    expect(pages).toHaveLength(findable(es).length * 3)
    expect(pages.find((p) => p.id === 'duplicates' && p.lang === 'es')?.path).toBe(
      '/casos-de-uso/quitar-duplicados-apple-music',
    )
    expect(pages.find((p) => p.id === 'duplicates' && p.lang === 'en')?.path).toBe(
      '/en/use-cases/remove-apple-music-duplicates',
    )
    expect(pages.find((p) => p.id === 'duplicates' && p.lang === 'ja')?.path).toBe(
      '/ja/use-cases/remove-apple-music-duplicates',
    )
  })

  // The language switch and hreflang must land on the same recipe, not on the index.
  it('pairs each recipe with the same recipe in the other language', () => {
    const page = recipePages().find((p) => p.id === 'nas' && p.lang === 'es')
    expect(page?.alternates).toEqual({
      es: '/casos-de-uso/musica-en-un-nas',
      en: '/en/use-cases/music-on-a-nas',
      ja: '/ja/use-cases/music-on-a-nas',
    })
  })

  // Before each recipe had a page, links pointed at an anchor on the index
  // (/casos-de-uso#nas). Those links are already out there in replies and chats.
  it('sends an old anchor link to the recipe page', () => {
    expect(recipePathForAnchor('es', '#nas')).toBe('/casos-de-uso/musica-en-un-nas')
    expect(recipePathForAnchor('en', '#duplicates')).toBe(
      '/en/use-cases/remove-apple-music-duplicates',
    )
    expect(recipePathForAnchor('ja', '#duplicates')).toBe(
      '/ja/use-cases/remove-apple-music-duplicates',
    )
    expect(recipePathForAnchor('es', '#main')).toBeNull()
    expect(recipePathForAnchor('es', '')).toBeNull()
  })
})

// The filters live in the address so a search can be shared or sent in a support reply,
// and so going back from a recipe lands on the same short list instead of all of them.
describe('use case filters in the address', () => {
  it('reads the query and the source from the address', () => {
    expect(filtersFromSearch('?q=cue+points&source=rekordbox')).toEqual({
      query: 'cue points',
      source: 'rekordbox',
    })
  })

  it('starts unfiltered when the address carries nothing or a source that does not exist', () => {
    expect(filtersFromSearch('')).toEqual({ query: '', source: null })
    expect(filtersFromSearch('?source=traktor')).toEqual({ query: '', source: null })
  })

  it('writes only what is set, so the unfiltered page keeps its clean address', () => {
    expect(searchForFilters({ query: '', source: null })).toBe('')
    expect(searchForFilters({ query: '  ', source: null })).toBe('')
    expect(searchForFilters({ query: 'nas', source: null })).toBe('?q=nas')
    expect(searchForFilters({ query: '', source: 'usb' })).toBe('?source=usb')
  })

  it('reads back what it writes', () => {
    const filters = { query: 'cue points & más', source: 'appleMusic' as const }
    expect(filtersFromSearch(searchForFilters(filters))).toEqual(filters)
  })
})

// The recipe names a typo the review flags in amber. Short names never are (the app keeps
// typos to eight letters and up, measured on a real library), and the example used to be
// one of those: a reader looked for an amber "Rahcel" that could never appear.
describe('the review recipe', () => {
  it('names a typo the review really flags', () => {
    const step = (es.useCases.cases as { id: string; steps: { text: string }[] }[])
      .find((c) => c.id === 'review-spellings')
      ?.steps.find((s) => s.text.includes('ámbar'))
    const [typo, right] = [...(step?.text ?? '').matchAll(/«([^»]+)»/g)].map((m) => m[1])
    const entry = (id: string, artist: string) => ({
      id,
      title: id,
      artist,
      albumArtist: '',
      album: '',
      genre: '',
    })
    const groups = spellingGroups([entry('a', right), entry('b', right), entry('c', typo)])
    expect(groups.map((g) => g.kind)).toEqual(['typo'])
  })
})

// The reader changes settings one Settings tab at a time, with the capture of that tab
// beside the list. The numbers drawn on each capture are the numbers in the list, so the
// grouping and the numbering here are what the capture script draws.
describe('use case settings by tab', () => {
  const s = (tab: string, setting: string) => ({ tab, setting, note: '' })

  it('groups the settings by tab in the order the recipe first visits each tab', () => {
    const groups = settingGroups([s('Destino', 'a'), s('Formato', 'b'), s('Destino', 'c')])
    expect(groups.map((g) => g.tab)).toEqual(['Destino', 'Formato'])
    expect(groups[0].settings.map((x) => x.setting)).toEqual(['a', 'c'])
  })

  it('numbers the settings straight through, so no number repeats across captures', () => {
    const groups = settingGroups([s('Destino', 'a'), s('Formato', 'b'), s('Destino', 'c')])
    expect(groups.flatMap((g) => g.settings.map((x) => x.n))).toEqual([1, 2, 3])
  })

  it('names each capture after the recipe, the tab position and the language', () => {
    expect(settingShot('es', 'replace', 0)).toBe('replace-1-es.webp')
  })

  // A recipe whose tab has no capture shows a broken image right where the reader is
  // stuck, and a capture with no size makes the page jump as it loads.
  it('has a sized capture for every tab every recipe visits, in every language', () => {
    for (const [lang, locale] of [
      ['es', es],
      ['en', en],
      ['ja', ja],
    ] as const) {
      const wanted = (locale.useCases.cases as { id: string; settings: Setting[] }[]).flatMap((c) =>
        settingGroups(c.settings).map((_, i) => settingShot(lang, c.id, i)),
      )
      expect(wanted.filter((f) => !USE_CASE_SHOTS[f])).toEqual([])
    }
  })
})
