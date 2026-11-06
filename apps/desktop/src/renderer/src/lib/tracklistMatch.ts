import type { CollectionTrack } from '../../../shared/types'
import { foldText } from './normalizeText'
import type { TracklistLine } from './tracklistParse'

export type MatchLevel = 'found' | 'doubtful' | 'similar' | 'absent'

export interface TracklistMatch {
  line: TracklistLine
  level: MatchLevel
  candidates: CollectionTrack[]
}

const NOBODY = new Set(['various artists', 'va', 'unknown'])
const ARTIST_WORDS = /\b(feat\.?|ft\.?|presents|pres\.?|vs\.?|meets)\b/gi
const ARTIST_CUTS = /,|&| and | x |\//
const ARTICLES = new Set(['a', 'the', 'el', 'la', 'los', 'las'])
const DICE_MIN = 0.6
const TYPO_SHARE = 0.2

function fold(text: string): string {
  return foldText(text.replace(/[’‘`´']/g, ''))
}

export function splitArtists(text: string): string[] {
  return text
    .toLowerCase()
    .replace(ARTIST_WORDS, ',')
    .split(ARTIST_CUTS)
    .map((part) => fold(part))
    .filter((part) => part && !NOBODY.has(part))
}

export function baseTitle(title: string): string {
  return fold(title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/-\d+$/, ''))
}

function overlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x === y || x.includes(y) || y.includes(x)))
}

function tokens(base: string): Set<string> {
  return new Set(base.split(' ').filter((w) => w && !ARTICLES.has(w)))
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return (2 * shared) / (a.size + b.size)
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

function typo(a: string, b: string): boolean {
  const budget = Math.max(1, Math.floor(TYPO_SHARE * Math.max(a.length, b.length)))
  return levenshtein(a, b) <= budget
}

interface Indexed {
  track: CollectionTrack
  full: string
  base: string
  words: Set<string>
  artists: string[]
}

function index(collection: CollectionTrack[]): Indexed[] {
  return collection.map((track) => {
    const base = baseTitle(track.title)
    return {
      track,
      full: fold(track.title),
      base,
      words: tokens(base),
      artists: splitArtists(track.artist),
    }
  })
}

function matchLine(line: TracklistLine, indexed: Indexed[]): TracklistMatch {
  const full = fold(line.title)
  const base = baseTitle(line.title)
  const words = tokens(base)
  const artists = splitArtists(line.artist)
  const named = artists.length > 0
  const rank = (c: Indexed): number => (c.full === full ? 2 : 1 + dice(words, c.words))
  const sorted = (list: Indexed[]): CollectionTrack[] =>
    list
      .map((c, i) => ({ c, i }))
      .sort((x, y) => rank(y.c) - rank(x.c) || x.i - y.i)
      .map(({ c }) => c.track)

  const byArtist = named ? indexed.filter((c) => overlap(artists, c.artists)) : []
  const exact = byArtist.filter((c) => c.full === full)
  if (exact.length === 1 && !line.suggested)
    return { line, level: 'found', candidates: [exact[0].track] }
  const doubtful = byArtist.filter(
    (c) =>
      c.full === full || c.base === base || dice(words, c.words) >= DICE_MIN || typo(base, c.base),
  )
  if (doubtful.length) return { line, level: 'doubtful', candidates: sorted(doubtful) }

  const similar = indexed.filter((c) => c.base === base)
  if (similar.length) return { line, level: 'similar', candidates: sorted(similar) }
  if (!named) {
    const ofArtist = indexed.filter((c) => c.artists.includes(full))
    if (ofArtist.length === 1) return { line, level: 'similar', candidates: [ofArtist[0].track] }
  }
  return { line, level: 'absent', candidates: [] }
}

export function matchTracklist(
  lines: TracklistLine[],
  collection: CollectionTrack[],
): TracklistMatch[] {
  const indexed = index(collection)
  return lines.map((line) => matchLine(line, indexed))
}
