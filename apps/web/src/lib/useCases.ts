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
  replace: ['appleMusic', 'rekordbox'],
  'apple-music-rekordbox': ['appleMusic', 'rekordbox'],
  'to-aiff': ['folder'],
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
  'music-playlist-set': ['appleMusic', 'usb'],
  nas: ['nas'],
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
