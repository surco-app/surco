import { type AppleMusicIndex, isAmbiguousCandidate, replaceCandidate } from './appleMusicLibrary'

export type SelectionReplaceMode = 'replace' | 'add' | 'mixed'

// What a convert of SEVERAL tracks should do about library copies, decided over the whole
// selection rather than per track.
//
// The rule is the user's, given 15/09: a batch where every track supersedes a copy is a
// replacement; a batch where none does is an add; a batch that mixes the two is refused so
// the button can disable itself and say why. One click doing two different things to
// different tracks is precisely the shape of failure that cost a day here — a button whose
// label promised one action while the click performed another.
//
// An ambiguous match counts as mixed: replacePatch already refuses to stamp one (replacing
// on a guess can overwrite the wrong song), so a selection containing one cannot be a clean
// replacement batch either.
export function selectionReplaceMode(
  index: AppleMusicIndex | null,
  tracks: { meta: { title: string; artist: string }; duration?: number }[],
): SelectionReplaceMode {
  // No snapshot means nothing is known about copies — not on macOS, or the library never
  // loaded. Refusing there would block a convert for a reason the user cannot act on.
  if (!index || tracks.length === 0) return 'add'

  let replacements = 0
  for (const track of tracks) {
    const candidate = replaceCandidate(index, {
      title: track.meta.title,
      artist: track.meta.artist,
      durationSec: track.duration,
    })
    if (candidate && isAmbiguousCandidate(candidate)) return 'mixed'
    if (candidate) replacements += 1
  }

  if (replacements === 0) return 'add'
  return replacements === tracks.length ? 'replace' : 'mixed'
}
