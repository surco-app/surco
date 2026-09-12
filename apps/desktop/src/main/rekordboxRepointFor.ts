import type { RekordboxRepoint } from './rekordboxBatch'

// What a finished conversion has to tell rekordbox, or null when it has nothing to say.
//
// Deliberately simpler than the Traktor rule next to it in ffmpeg.ts. Traktor addresses a
// track as volume + directory + file and only ever rewrites the file part, so a
// conversion that writes into a different folder cannot be followed there and is left
// pointing at the original on purpose. rekordbox keeps the whole path in one column, so
// the entry can follow the file wherever it landed — which is what the user asked for.
export function rekordboxRepointFor(input: string, output: string): RekordboxRepoint | null {
  if (input === output) return null
  return { from: input, to: output }
}
