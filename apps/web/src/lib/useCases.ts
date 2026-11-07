import { LANGUAGES, type Language } from '../i18n'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import { PAGES } from './nav'
import shots from './useCaseShots.json'

export const USE_CASE_SOURCES = [
  'folder',
  'appleMusic',
  'rekordbox',
  'engineDj',
  'traktor',
  'usb',
  'nas',
] as const

export type UseCaseSource = (typeof USE_CASE_SOURCES)[number]

export const USE_CASE_SOURCES_BY_CASE: Record<string, UseCaseSource[]> = {
  'in-place': ['folder'],
  replace: ['appleMusic', 'rekordbox', 'engineDj'],
  'apple-music-rekordbox': ['appleMusic', 'rekordbox'],
  'to-aiff': ['folder', 'rekordbox'],
  'other-formats': ['folder'],
  'check-quality': ['folder'],
  vinyl: ['folder'],
  usb: ['usb', 'rekordbox', 'engineDj'],
  'to-mp3': ['folder', 'usb'],
  'review-spellings': ['appleMusic'],
  duplicates: ['appleMusic'],
  'review-folder': ['folder'],
  'find-replace': ['folder'],
  beatport: ['folder'],
  'watched-folder': ['folder'],
  loudness: ['folder'],
  'engine-dj': ['engineDj'],
  'rekordbox-cues': ['rekordbox'],
  'music-playlist-set': ['appleMusic', 'usb'],
  nas: ['nas'],
  'paste-tracklist': ['rekordbox', 'traktor'],
  'traktor-convert': ['traktor'],
  'fake-hires': ['folder'],
  'repair-library': ['appleMusic', 'traktor', 'engineDj'],
  'organize-playlists': ['rekordbox', 'traktor'],
  'custom-fields': ['folder'],
}

export type UseCaseFilters = { query: string; source: UseCaseSource | null }

const isSource = (value: string | null): value is UseCaseSource =>
  USE_CASE_SOURCES.some((s) => s === value)

export function filtersFromSearch(search: string): UseCaseFilters {
  const params = new URLSearchParams(search)
  const source = params.get('source')
  return { query: params.get('q') ?? '', source: isSource(source) ? source : null }
}

export function searchForFilters({ query, source }: UseCaseFilters): string {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query)
  if (source) params.set('source', source)
  const search = params.toString()
  return search ? `?${search}` : ''
}

type Searchable = { id: string; title: string; body: string[]; keywords: string }

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/(?<=\p{Script=Latin})\p{Diacritic}+/gu, '')
    .normalize('NFC')

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

export function matchesUseCase(c: Searchable, query: string, source: UseCaseSource | null) {
  if (source && !USE_CASE_SOURCES_BY_CASE[c.id]?.includes(source)) return false
  const haystack = words([c.title, ...c.body, c.keywords].join(' '))
  return words(query).every((q) =>
    haystack.some((w) =>
      /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(q)
        ? w.includes(q)
        : w.startsWith(q),
    ),
  )
}

type PagedCase = { id: string; slug: string }

// Spanish recipes carry Spanish slugs; every other language is served under the English
// ones, so a link keeps working whichever language it is opened in.
const CASES = Object.fromEntries(
  LANGUAGES.map((lng): [Language, PagedCase[]] => [
    lng,
    lng === 'es' ? es.useCases.cases : en.useCases.cases,
  ]),
) as Record<Language, PagedCase[]>

export const recipePath = (lang: Language, slug: string) => `${PAGES.useCases[lang]}/${slug}`
export const recipePathForId = (lang: Language, id: string) => {
  const c = CASES[lang].find((entry) => entry.id === id)
  if (!c) throw new Error(`Unknown use case: ${id}`)
  return recipePath(lang, c.slug)
}

const pathOf = (lang: Language, c: PagedCase) => recipePath(lang, c.slug)

export type RecipePage = {
  id: string
  lang: Language
  path: string
  alternates: Record<Language, string>
}

export function recipePages(): RecipePage[] {
  return LANGUAGES.flatMap((lang) =>
    CASES[lang].map((c) => {
      const alternates = Object.fromEntries(
        LANGUAGES.map((other) => [
          other,
          pathOf(other, CASES[other].find((o) => o.id === c.id) ?? c),
        ]),
      ) as Record<Language, string>
      return { id: c.id, lang, path: alternates[lang], alternates }
    }),
  )
}

export function recipePathForAnchor(lang: Language, hash: string): string | null {
  const c = CASES[lang].find((o) => `#${o.id}` === hash)
  return c ? pathOf(lang, c) : null
}

export const USE_CASE_SHOTS: Record<string, number[] | undefined> = shots

export type DjProgram = 'traktor' | 'rekordbox' | 'engine'

export const DJ_PROGRAM_NAMES: Record<DjProgram, string> = {
  traktor: 'Traktor',
  rekordbox: 'rekordbox',
  engine: 'Engine DJ',
}

export function settingGroups<S extends { tab: string; program?: DjProgram }>(settings: S[]) {
  const groups: { tab: string; program?: DjProgram; settings: (S & { n: number })[] }[] = []
  for (const s of settings) {
    const row = { ...s, n: 0 }
    const group = groups.find((g) => g.tab === s.tab && g.program === s.program)
    if (group) group.settings.push(row)
    else groups.push({ tab: s.tab, program: s.program, settings: [row] })
  }
  let n = 0
  for (const g of groups) for (const s of g.settings) s.n = ++n
  return groups
}

export const settingShot = (lang: Language, id: string, index: number) =>
  `${id}-${index + 1}-${lang}.webp`

export function recipeIndex<
  G extends { id: string; title: string },
  C extends { id: string; group: string; title: string },
>(groups: G[], cases: C[]) {
  return groups
    .map((g) => ({ id: g.id, title: g.title, cases: cases.filter((c) => c.group === g.id) }))
    .filter((g) => g.cases.length > 0)
}

export const stepLead = (title: string, lang: Language) =>
  /[.!?。！？]$/.test(title) ? title : `${title}${lang === 'ja' ? '。' : '.'}`
