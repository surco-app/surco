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

interface CopyLength {
  durationSec?: number
  // The comparison's CopyVerdict.sameMasterAcrossGap: one master despite the lengths.
  sameMasterAcrossGap?: boolean
}

interface CopyRow extends CopyLength {
  program: DjProgram
  path: string
  verdict: LibraryVerdict | null
}

// No verdict rules out another edit on its own: «same» can come from the pair probe over the
// first 91 s, which a longer or shorter edit cut from the same master passes too, and the
// comparison calls another version only with both lengths known. So a copy counts only when
// both lengths are known and no further apart than a drift or a rounding leaves, or when the
// comparison's wider search lined the whole of both up as one master across the gap.
function lengthsMatch(copy: CopyLength, fileDurationSec: number | undefined) {
  if (copy.sameMasterAcrossGap) return true
  if (copy.durationSec === undefined || fileDurationSec === undefined) return false
  return Math.abs(copy.durationSec - fileDurationSec) <= VERSION_GAP_SEC
}

export function copyPathIn(
  program: DjProgram,
  rows: readonly CopyRow[],
  fileDurationSec?: number,
): string | undefined {
  return rows.find(
    (row) =>
      row.program === program && countsAsCopy(row.verdict) && lengthsMatch(row, fileDurationSec),
  )?.path
}

export interface FillCandidate extends CopyLength {
  path: string
  verdict: LibraryVerdict | null
}

interface FillCopies {
  // The Apple Music copy a replacement would supersede, with its row's verdict and length.
  musicCopy: FillCandidate | null
  musicCopyPending: boolean
  programs: readonly FillCandidate[]
  // A DJ collection still being read may hold a copy ahead of the ones listed.
  programsPending: boolean
  fileDurationSec: number | undefined
}

// The copy that fills is the first, Apple Music before the programs, that counts as a copy
// with a matching length. A copy still being compared stops the search where it stands,
// whatever its length says so far: nothing is read while it comes first, even when a later
// copy is ready, since only its verdict tells whether its tags are this file's.
export function fillCopyPath(args: FillCopies): string {
  if (args.musicCopyPending) return ''
  const first = copiesOf(args).find(
    (copy) =>
      countsAsCopy(copy.verdict) &&
      (copy.verdict === 'measuring' || lengthsMatch(copy, args.fileDurationSec)),
  )
  if (!first || first.verdict === 'measuring') return ''
  if (args.programsPending && first !== args.musicCopy) return ''
  return first.path
}

function copiesOf(args: FillCopies): FillCandidate[] {
  return [...(args.musicCopy?.path ? [args.musicCopy] : []), ...args.programs]
}

// «Another version» in the section: the comparison said so, or the verdict counts but both
// lengths are known and further apart than a drift leaves, and nothing lined them up as one
// master across that gap. An unknown length proves nothing.
export function isAnotherVersion(
  copy: FillCandidate,
  fileDurationSec: number | undefined,
): boolean {
  if (copy.verdict === 'different') return true
  return (
    countsAsCopy(copy.verdict) &&
    copy.verdict !== 'measuring' &&
    copy.durationSec !== undefined &&
    fileDurationSec !== undefined &&
    !lengthsMatch(copy, fileDurationSec)
  )
}

// The copy that lends only its grouping and cover, when no copy of the same recording fills.
// It waits for every copy still compared or located and every DJ collection still read: any
// of them may yet prove to be the same recording, whose fill the track gets once and which
// must not be spent on another version.
export function versionCopyPath(args: FillCopies): string {
  if (fillCopyPath(args) || args.musicCopyPending || args.programsPending) return ''
  const copies = copiesOf(args)
  if (copies.some((copy) => copy.verdict === 'measuring')) return ''
  return copies.find((copy) => isAnotherVersion(copy, args.fileDurationSec))?.path ?? ''
}

// The copy whose playlists the program's field stages on the track, one program at a time.
// A copy of the same recording in that program takes it, since the field acts on that copy
// at once; and a copy still compared or a collection still read may yet prove to be one.
export function versionCopyIn(
  program: DjProgram,
  rows: readonly CopyRow[],
  fileDurationSec: number | undefined,
  programsPending: boolean,
): string {
  const own = rows.filter((row) => row.program === program)
  if (programsPending || own.some((row) => row.verdict === 'measuring')) return ''
  if (copyPathIn(program, own, fileDurationSec)) return ''
  return own.find((row) => isAnotherVersion(row, fileDurationSec))?.path ?? ''
}

export interface CopyCandidate extends CopyLength {
  program: PlaylistSource
  // '' while Apple Music still looks the file up.
  path: string
  // As the section's row shows it, e.g. "AIFF 16/44.1".
  format: string
  verdict: LibraryVerdict | null
  better: boolean
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
      (lengthsMatch(candidate, fileDurationSec) ||
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
