import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import { PAGES } from './nav'
import shots from './useCaseShots.json'

export const USE_CASE_SOURCES = [
  'folder',
  'appleMusic',
  'rekordbox',
  'engineDj',
  'usb',
  'nas',
] as const

export type UseCaseSource = (typeof USE_CASE_SOURCES)[number]

export const USE_CASE_SOURCES_BY_CASE: Record<string, UseCaseSource[]> = {
  'in-place': ['folder'],
  replace: ['appleMusic', 'rekordbox', 'engineDj'],
  'apple-music-rekordbox': ['appleMusic', 'rekordbox'],
  'to-aiff': ['folder', 'rekordbox'],
  'check-quality': ['folder'],
  vinyl: ['folder'],
  usb: ['usb'],
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
    .replace(/\p{Diacritic}/gu, '')

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

export function matchesUseCase(c: Searchable, query: string, source: UseCaseSource | null) {
  if (source && !USE_CASE_SOURCES_BY_CASE[c.id]?.includes(source)) return false
  const haystack = words([c.title, ...c.body, c.keywords].join(' '))
  return words(query).every((q) => haystack.some((w) => w.startsWith(q)))
}

type Lang = 'es' | 'en'
type PagedCase = { id: string; slug: string }

const CASES: Record<Lang, PagedCase[]> = {
  es: es.useCases.cases,
  en: en.useCases.cases,
}

export const recipePath = (lang: Lang, slug: string) => `${PAGES.useCases[lang]}/${slug}`

const pathOf = (lang: Lang, c: PagedCase) => recipePath(lang, c.slug)

export type RecipePage = {
  id: string
  lang: Lang
  path: string
  alternates: Record<Lang, string>
}

export function recipePages(): RecipePage[] {
  return (['es', 'en'] as const).flatMap((lang) =>
    CASES[lang].map((c) => {
      const alternates = {
        es: pathOf('es', CASES.es.find((o) => o.id === c.id) ?? c),
        en: pathOf('en', CASES.en.find((o) => o.id === c.id) ?? c),
      }
      return { id: c.id, lang, path: alternates[lang], alternates }
    }),
  )
}

export function recipePathForAnchor(lang: Lang, hash: string): string | null {
  const c = CASES[lang].find((o) => `#${o.id}` === hash)
  return c ? pathOf(lang, c) : null
}

export const USE_CASE_SHOTS: Record<string, number[] | undefined> = shots

export function settingGroups<S extends { tab: string }>(settings: S[]) {
  const groups: { tab: string; settings: (S & { n: number })[] }[] = []
  for (const s of settings) {
    const row = { ...s, n: 0 }
    const group = groups.find((g) => g.tab === s.tab)
    if (group) group.settings.push(row)
    else groups.push({ tab: s.tab, settings: [row] })
  }
  let n = 0
  for (const g of groups) for (const s of g.settings) s.n = ++n
  return groups
}

export const settingShot = (lang: Lang, id: string, index: number) =>
  `${id}-${index + 1}-${lang}.webp`
