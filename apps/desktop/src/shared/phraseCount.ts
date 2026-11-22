const PHRASE = 32
const SEPARATOR = ' · '
const COUNT = /^\d+(?: \(-?\d+\))?(?: - \d+(?: \(-?\d+\))?)*$/

function nearestBeat(ms: number, grid: { ms: number }[]): number {
  let lo = 0
  let hi = grid.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (grid[mid].ms <= ms) lo = mid
    else hi = mid
  }
  return ms - grid[lo].ms <= grid[hi].ms - ms ? lo : hi
}

function phraseLabel(beats: number): string {
  const phrases = Math.floor(beats / PHRASE)
  const spare = beats % PHRASE
  if (spare === 0) return String(phrases)
  if (spare <= PHRASE / 2) return `${phrases} (${spare})`
  return `${phrases + 1} (-${PHRASE - spare})`
}

export function phraseCount(
  cues: { ms: number; kind: number; loop?: boolean }[],
  grid: { ms: number }[],
): string | null {
  if (grid.length < 2) return null
  const beats = [
    ...new Set(cues.filter((c) => c.kind === 0 && !c.loop).map((c) => nearestBeat(c.ms, grid))),
  ].sort((a, b) => a - b)
  if (beats.length < 2) return null
  return beats
    .slice(1)
    .map((beat, i) => phraseLabel(beat - beats[i]))
    .join(' - ')
}

export function withPhraseCount(comment: string, count: string): string {
  const at = comment.indexOf(SEPARATOR)
  const head = at === -1 ? comment : comment.slice(0, at)
  const rest = COUNT.test(head) ? (at === -1 ? '' : comment.slice(at + SEPARATOR.length)) : comment
  return rest ? `${count}${SEPARATOR}${rest}` : count
}

export type CommentMode = 'prepend' | 'replace'

const MY_TAGS_BLOCK = /\/\*[\s\S]*?\*\/\s*$/

export function phrasedComment(comment: string, count: string, mode: CommentMode): string {
  if (mode === 'prepend') return withPhraseCount(comment, count)
  const tags = comment.match(MY_TAGS_BLOCK)
  return tags ? `${count}${SEPARATOR}${tags[0].trim()}` : count
}
