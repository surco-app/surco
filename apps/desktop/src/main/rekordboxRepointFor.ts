import type { RekordboxRepoint } from './rekordboxBatch'

// What a finished conversion has to tell rekordbox, or null when it has nothing to say.
//
// Deliberately simpler than the Traktor rule next to it in ffmpeg.ts. Traktor addresses a
// track as volume + directory + file and only ever rewrites the file part, so a
// conversion that writes into a different folder cannot be followed there and is left
// pointing at the original on purpose. rekordbox keeps the whole path in one column, so
// the entry can follow the file wherever it landed — which is what the user asked for.
export function rekordboxRepointFor(
  input: string,
  output: string,
  // The file this conversion supersedes, when it is replacing a copy already in the
  // library. That file — not the one being converted — is what the collection has indexed:
  // a FLAC downloaded into some folder has never been in rekordbox, so repointing from it
  // matched nothing and left the entry on the old MP3.
  options: { replaces?: string } = {},
): RekordboxRepoint | null {
  const from = options.replaces ?? input
  if (from === output) return null
  return { from, to: output }
}
