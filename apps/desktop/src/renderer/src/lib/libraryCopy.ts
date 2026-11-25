import { VERSION_GAP_SEC } from '../../../shared/copyVersion'
import type { DjProgram } from '../../../shared/djProgram'
import { formatMatchesInput } from '../../../shared/format'
import { OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type { LibraryCopyAction, OutputFormat, PlaylistSource } from '../../../shared/types'
import type { LibraryVerdict } from '../components/LibrarySection'
import type { TrackItem } from '../types'
import { isAmbiguousCandidate, type ReplaceCandidate } from './appleMusicLibrary'
import { replacePatch } from './replaceBeforeConvert'

const COPY_VERDICTS: ReadonlySet<LibraryVerdict> = new Set([
  'same',
  'even',
  'tie',
  'here',
  'library',
  'unmeasurable',
  // The copy was already found, only which of the two is better is still unknown.
  'measuring',
])

// 'several' is left out: with tied copies Surco cannot tell which one is the track.
export function countsAsCopy(verdict: LibraryVerdict | null | undefined): boolean {
  return verdict != null && COPY_VERDICTS.has(verdict)
}

interface CopyRow {
  program: DjProgram
  path: string
  verdict: LibraryVerdict | null
  durationSec?: number
}

// No verdict rules out another edit on its own: «same» can come from the pair probe over the
// first 91 s, which a longer or shorter edit cut from the same master passes too, and the
// comparison calls another version only with both lengths known. So a copy counts only when
// both lengths are known and no further apart than a drift or a rounding leaves.
function lengthsMatch(copyDurationSec: number | undefined, fileDurationSec: number | undefined) {
  if (copyDurationSec === undefined || fileDurationSec === undefined) return false
  return Math.abs(copyDurationSec - fileDurationSec) <= VERSION_GAP_SEC
}

export function copyPathIn(
  program: DjProgram,
  rows: readonly CopyRow[],
  fileDurationSec?: number,
): string | undefined {
  return rows.find(
    (row) =>
      row.program === program &&
      countsAsCopy(row.verdict) &&
      lengthsMatch(row.durationSec, fileDurationSec),
  )?.path
}

export interface FillCandidate {
  path: string
  verdict: LibraryVerdict | null
  durationSec?: number
}

// The DJ copy that fills is the first, in program order, that counts as a copy with a matching
// length. A copy still being compared stops the search where it stands, whatever its length
// says so far: nothing is read while it comes first, even when a later copy is ready, since
// only its verdict tells whether its tags are this file's.
export function fillCopyPath(args: {
  musicCopyPath: string
  musicCopyPending: boolean
  programs: readonly FillCandidate[]
  fileDurationSec: number | undefined
}): string {
  if (args.musicCopyPath) return args.musicCopyPath
  if (args.musicCopyPending) return ''
  const first = args.programs.find(
    (copy) =>
      countsAsCopy(copy.verdict) &&
      (copy.verdict === 'measuring' || lengthsMatch(copy.durationSec, args.fileDurationSec)),
  )
  if (!first || first.verdict === 'measuring') return ''
  return first.path
}

export interface CopyCandidate {
  program: PlaylistSource
  // '' while Apple Music still looks the file up.
  path: string
  // As the section's row shows it, e.g. "AIFF 16/44.1".
  format: string
  verdict: LibraryVerdict | null
  better: boolean
  durationSec?: number
  // Only on the Apple Music candidate, and never an ambiguous match.
  music?: ReplaceCandidate
}

export interface LibraryCopyTarget extends Omit<CopyCandidate, 'verdict'> {
  held: boolean
}

export interface LibraryCopyRef {
  path: string
  program: PlaylistSource
  musicPersistentId?: string
}

// The same rule as copyPathIn, for every candidate: a verdict alone cannot rule out another
// edit, so the lengths must match too. A copy still measured or looked up has no length yet
// and is taken held: dropping it meanwhile let the body say Convert, and a press add a
// duplicate beside the copy Surco had just found. Once measured, the lengths decide.
export function pickLibraryCopy(
  candidates: readonly CopyCandidate[],
  fileDurationSec: number | undefined,
): LibraryCopyTarget | null {
  const copy = candidates.find(
    (candidate) =>
      countsAsCopy(candidate.verdict) &&
      (lengthsMatch(candidate.durationSec, fileDurationSec) ||
        (candidate.durationSec === undefined &&
          (candidate.verdict === 'measuring' || candidate.path === ''))),
  )
  if (!copy) return null
  const { verdict, ...target } = copy
  // A copy still being compared may yet turn out to be another version, and Apple Music's
  // copy without a path gives nothing to update or replace: the press waits for both.
  return { ...target, held: verdict === 'measuring' || copy.path === '' }
}

export function replaceCopyPatch(target: LibraryCopyTarget, openPath: string): Partial<TrackItem> {
  if (target.music) return replacePatch(target.music, openPath) ?? {}
  // A DJ copy is replaced by its file alone: stamping a musicPersistentId would make the
  // convert write over an Apple Music entry the user was never offered.
  return { replacesPath: target.path, replaceDone: undefined }
}

export function copyRefOf(target: LibraryCopyTarget): LibraryCopyRef {
  const ref: LibraryCopyRef = { path: target.path, program: target.program }
  if (target.music && !isAmbiguousCandidate(target.music))
    ref.musicPersistentId = target.music.persistentId
  return ref
}

// A menu Replace runs at once only when it is known to cost no Serato stars. On a Serato copy
// whose collection is not read yet the answer is surely a loss to come, so it waits too.
export function replaceWarnsFirst(
  program: PlaylistSource,
  losesStars: boolean | undefined,
): boolean {
  return losesStars === true || (losesStars === undefined && program === 'serato')
}

export function keptFormatOf(path: string): OutputFormat | undefined {
  return OUTPUT_FORMATS.find((format) => formatMatchesInput(format, path))
}

export interface LibraryCopyOffer {
  // "rekordbox", "Apple Music"
  name: string
  // As the section's row shows it, e.g. "AIFF 16/44.1".
  format: string
  action: LibraryCopyAction
  better: boolean
  held: boolean
  // The copy's own format, which Update keeps since it never touches the audio.
  keptFormat?: OutputFormat
  // False for a copy in a format Surco can't write, which Update can't retag.
  updatable?: boolean
  // Replacing this copy repoints Serato to a new file, which loses the copy's stars.
  replaceLosesStars?: boolean
}
