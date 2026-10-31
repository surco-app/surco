import { Genres } from 'node-taglib-sharp'

export type GenreSource = 'rekordbox' | 'traktor' | 'engine' | 'info'

export type GenreJudgement = {
  kind: 'genre-number' | 'genre-parens'
  certainty: 'sure' | 'likely'
  options: string[]
  source?: GenreSource
}

const MAX_SAVES = 4
const COVER = 'Cover'
const REMIX = 'Remix'

function direct(index: string): string | undefined {
  return /\d+/.test(index) ? Genres.AUDIO_GENRES[Number(index)] : undefined
}

function standardNumeric(field: string): string[] | undefined {
  if (field[0] !== '(') return undefined
  const results: string[] = []
  let inParentheses = true
  let refinementAdded = false
  let open = 0
  const append = (chunk: string) => {
    if (!chunk) return
    const last = results[results.length - 1]
    results[results.length - 1] = refinementAdded ? `${last}${chunk}` : `${last} ${chunk}`
  }
  for (let i = 1; i < field.length; i++) {
    if (inParentheses) {
      if (field[i] !== ')') continue
      const inside = field.substring(open + 1, i)
      const genre =
        direct(inside) ?? (inside === 'CR' ? COVER : inside === 'RX' ? REMIX : undefined)
      if (genre === undefined) break
      results.push(genre)
      inParentheses = false
      refinementAdded = false
      open = i + 1
    } else if (field[i] === '(') {
      if (field[i + 1] === '(') {
        append(field.substring(open, i + 1))
        open = i + 2
        i++
      } else {
        append(field.substring(open, i))
        inParentheses = true
        open = i
      }
      refinementAdded = true
    }
  }
  if (results.length === 0) return undefined
  append(field.substring(open))
  return results
}

function parseOld(value: string): string[] {
  const fields: string[] = []
  for (const term of value.split(/[;/]/).filter((t) => !!t)) {
    const numeric = standardNumeric(term)
    if (numeric) fields.push(...numeric)
    else fields.push(direct(term) ?? term)
  }
  while (fields.length > 0 && !fields[fields.length - 1]) fields.pop()
  return fields
}

function renderV23(fields: string[]): string {
  const numeric: string[] = []
  const text: string[] = []
  for (const s of fields) {
    if (s === COVER) numeric.push('(CR)')
    else if (s === REMIX) numeric.push('(RX)')
    else if (Genres.audioToIndex(s) !== 255) numeric.push(`(${Genres.audioToIndex(s)})`)
    else text.push(s.replace(/\(/g, '(('))
  }
  return `${numeric.join('')}${text.join(';')}`
}

export function damageV23(text: string): string {
  return renderV23(parseOld(text))
}

function leadingNumber(raw: string): { name: string; rest: string } | null {
  const m = /^\((\d+)\)/.exec(raw)
  const name = m ? Genres.indexToAudio(Number(m[1]), false) : undefined
  return m && name ? { name, rest: raw.slice(m[0].length) } : null
}

export function hasGenreMarker(raw: string): boolean {
  return leadingNumber(raw) !== null || raw.includes('((')
}

function replaysTo(candidate: string, raw: string): boolean {
  let out = candidate
  for (let i = 0; i < MAX_SAVES; i++) {
    out = damageV23(out)
    if (out === raw) return true
  }
  return false
}

function candidates(raw: string): string[] {
  const number = leadingNumber(raw)
  const base = number?.rest
    ? `${number.name}${number.rest.startsWith(' ') ? ';' : '/'}${number.rest}`
    : raw
  const collapsed = base.replace(/\(+/g, '(')
  const slashed = collapsed.includes('(') ? collapsed.replace(/ ; /g, ' / ') : collapsed
  return slashed === collapsed ? [collapsed] : [slashed, collapsed]
}

export function judgeGenre(
  raw: string,
  evidence: { source: GenreSource; value: string }[],
): GenreJudgement | null {
  if (!hasGenreMarker(raw)) return null
  const kind = leadingNumber(raw) ? 'genre-number' : 'genre-parens'
  const proof = evidence.find((e) => e.value !== raw && replaysTo(e.value, raw))
  if (proof) return { kind, certainty: 'sure', options: [proof.value], source: proof.source }
  const options = candidates(raw).filter((c) => c !== raw && replaysTo(c, raw))
  return options.length > 0 ? { kind, certainty: 'likely', options } : null
}
