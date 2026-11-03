const WORDS_PER_SECOND = 150

export function shiftedWords(words: Uint16Array, shiftMs: number): Uint16Array {
  const lead = Math.round((shiftMs * WORDS_PER_SECOND) / 1000)
  const out = new Uint16Array(lead + words.length)
  out.set(words, lead)
  return out
}
