import { VERSION_GAP_SEC } from '../../../shared/copyVersion'
import type { DjProgram } from '../../../shared/djProgram'
import { formatMatchesInput } from '../../../shared/format'
import { OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type {
  LibraryCopyAction,
  OutputFormat,
  PairProbe,
  PlaylistSource,
  SpectrumVerdict,
} from '../../../shared/types'
import type { LibraryRow, LibraryVerdict } from '../components/LibrarySection'
import type { CopyReach } from '../hooks/useCopyReach'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import type { ProgramCopy } from '../hooks/useProgramCopies'
import type { TrackItem } from '../types'
import {
  isAmbiguousCandidate,
  type ReplaceCandidate,
  type StaleLibraryCopy,
} from './appleMusicLibrary'
import { type CopyFacts, type CopyVerdict, compareCopies } from './bestCopy'
import { rowVerdict } from './libraryVerdict'
import { pathKey } from './pathKey'
import { fileExtension } from './properties'
import { replacePatch } from './replaceBeforeConvert'
import { replaceWarning } from './replaceWarning'
import { LIBRARY_NAME } from './reviewLibraries'

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
      (copy.verdict === 'measuring' || lengthsMatch(copy.durationSec, args.fileDurationSec)),
  )
  if (!first || first.verdict === 'measuring') return ''
  if (args.programsPending && first !== args.musicCopy) return ''
  return first.path
}

function copiesOf(args: FillCopies): FillCandidate[] {
  return [...(args.musicCopy?.path ? [args.musicCopy] : []), ...args.programs]
}

// «Another version» in the section: the comparison said so, or the verdict counts but both
// lengths are known and further apart than a drift leaves. An unknown length proves nothing.
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
    !lengthsMatch(copy.durationSec, fileDurationSec)
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

export interface ComparedCopyContext {
  libraryCopyPath: string
  inputPath: string
  isMulti: boolean
}

export interface ComparedCopy {
  comparedCopyPath: string
  musicHoldsFile: boolean
}

export function comparedCopyOf({
  libraryCopyPath,
  inputPath,
  isMulti,
}: ComparedCopyContext): ComparedCopy {
  // A track opened from the library's own folder is that copy, so there is nothing to compare.
  const libraryCopyIsThisFile = pathKey(libraryCopyPath) === pathKey(inputPath)
  const comparedCopyPath = libraryCopyIsThisFile || isMulti ? '' : libraryCopyPath
  const musicHoldsFile = !!libraryCopyPath && libraryCopyIsThisFile
  return { comparedCopyPath, musicHoldsFile }
}

type SpectrumSide = Pick<SpectrumVerdict, 'cutoffHz' | 'hasKnee'>

export interface CopyComparisonContext {
  musicCopyReach: CopyReach | undefined
  hereFacts: CopyFacts | null | undefined
  libraryFacts: CopyFacts | null | undefined
  copyPair: PairProbe | null | undefined
  comparedCopyPath: string
  copyOpenFor: string
  inputPath: string
  libraryCopyPath: string
  spectrumInHand: SpectrumSide | undefined
  replacedCopySpectrum: SpectrumSide | undefined
}

export interface CopyComparison {
  musicCopyUnreached: boolean
  copyVerdict: CopyVerdict | null
  copyMeasuring: boolean
  copyOpen: boolean
  libraryCopyBetter: boolean
}

export function copyComparisonOf({
  musicCopyReach,
  hereFacts,
  libraryFacts,
  copyPair,
  comparedCopyPath,
  copyOpenFor,
  inputPath,
  libraryCopyPath,
  spectrumInHand,
  replacedCopySpectrum,
}: CopyComparisonContext): CopyComparison {
  const musicCopyUnreached =
    !!musicCopyReach && (musicCopyReach.missing || musicCopyReach.unreadable)
  const copyVerdict =
    hereFacts && libraryFacts && copyPair !== undefined
      ? compareCopies(hereFacts, libraryFacts, copyPair)
      : null
  const copyMeasuring =
    !!comparedCopyPath &&
    (hereFacts === undefined || libraryFacts === undefined || copyPair === undefined)
  const copyOpen =
    !!copyVerdict &&
    copyVerdict.winner !== 'same' &&
    copyOpenFor === `${inputPath}\n${libraryCopyPath}`
  const libraryCopyBetter = copyVerdict
    ? copyVerdict.winner === 'b'
    : !!libraryCopyPath &&
      replaceWarning(
        {
          ext: fileExtension(libraryCopyPath),
          cutoffHz: replacedCopySpectrum?.cutoffHz ?? undefined,
          hasKnee: replacedCopySpectrum?.hasKnee,
        },
        {
          ext: fileExtension(inputPath),
          cutoffHz: spectrumInHand?.cutoffHz ?? undefined,
          hasKnee: spectrumInHand?.hasKnee,
        },
      ) !== null
  return { musicCopyUnreached, copyVerdict, copyMeasuring, copyOpen, libraryCopyBetter }
}

export interface MusicCopy extends CopyCandidate {
  program: 'appleMusic'
  music: StaleLibraryCopy
}

export interface MusicCopyContext {
  replaceTarget: ReplaceCandidate | null
  musicRow: LibraryRow | null
  replacedCopyFormat: string
  libraryCopyBetter: boolean
  musicEntryDurationSec: number | undefined
}

export type MusicCopyResult = { musicCopy: MusicCopy | null }

export function musicCopyOf({
  replaceTarget,
  musicRow,
  replacedCopyFormat,
  libraryCopyBetter,
  musicEntryDurationSec,
}: MusicCopyContext): MusicCopyResult {
  const musicCopy =
    replaceTarget && !isAmbiguousCandidate(replaceTarget) && musicRow
      ? {
          program: 'appleMusic' as const,
          path: replaceTarget.path ?? '',
          format: replacedCopyFormat,
          verdict: musicRow.verdict,
          better: libraryCopyBetter,
          durationSec: musicRow.durationSec ?? musicEntryDurationSec,
          music: replaceTarget,
        }
      : null
  return { musicCopy }
}

export interface PickedCopyContext {
  isMulti: boolean
  musicCopy: MusicCopy | null
  musicHoldsFile: boolean
  comparedProgramCopies: readonly ProgramCopy[]
  programVerdicts: readonly CopyVerdictState[]
  copyRows: readonly CopyRow[]
  fileDurationSec: number | undefined
}

export type PickedCopyResult = { pickedCopy: LibraryCopyTarget | null }

export function pickedCopyOf({
  isMulti,
  musicCopy,
  musicHoldsFile,
  comparedProgramCopies,
  programVerdicts,
  copyRows,
  fileDurationSec,
}: PickedCopyContext): PickedCopyResult {
  const copyCandidates: CopyCandidate[] = isMulti
    ? []
    : [
        ...(musicCopy && !musicHoldsFile ? [musicCopy] : []),
        ...comparedProgramCopies.map((copy, i) => {
          const state = programVerdicts[i]
          return {
            program: copy.program,
            path: copy.path,
            format: state?.format ?? '',
            verdict: rowVerdict(state),
            better: rowVerdict(state) === 'library',
            durationSec: copyRows[i].durationSec,
          }
        }),
      ]
  return { pickedCopy: pickLibraryCopy(copyCandidates, fileDurationSec) }
}

export interface LibraryTargetContext {
  pickedCopy: LibraryCopyTarget | null
  pickedIsThisFile: boolean | undefined
}

export interface LibraryTarget {
  libraryTarget: LibraryCopyTarget | null
  keptFormat: OutputFormat | undefined
}

export function libraryTargetOf({
  pickedCopy,
  pickedIsThisFile,
}: LibraryTargetContext): LibraryTarget {
  const libraryTarget =
    pickedCopy && !pickedIsThisFile
      ? { ...pickedCopy, held: pickedCopy.held || pickedIsThisFile === undefined }
      : null
  const keptFormat = libraryTarget ? keptFormatOf(libraryTarget.path) : undefined
  return { libraryTarget, keptFormat }
}

export interface LibraryCopyOfferContext {
  libraryTarget: LibraryCopyTarget | null
  keptFormat: OutputFormat | undefined
  replaceStarsLoss: boolean | undefined
  libraryCopyAction: LibraryCopyAction
}

export interface LibraryCopyOfferResult {
  copyAction: LibraryCopyAction
  libraryCopy: LibraryCopyOffer | undefined
}

export function libraryCopyOfferOf({
  libraryTarget,
  keptFormat,
  replaceStarsLoss,
  libraryCopyAction,
}: LibraryCopyOfferContext): LibraryCopyOfferResult {
  const replaceLosesStars =
    !!libraryTarget && replaceWarnsFirst(libraryTarget.program, replaceStarsLoss)
  // A copy in no format Surco writes can't be updated in place, but it is still the track, so
  // the body replaces it: offering nothing let the body say Convert and add a second entry
  // beside it. Apple Music's copy with no path yet has no format to judge, so the pick holds.
  const updatable = !!keptFormat || !libraryTarget?.path
  const copyAction: LibraryCopyAction = updatable ? libraryCopyAction : 'replace'
  const libraryCopy: LibraryCopyOffer | undefined = libraryTarget
    ? {
        name:
          libraryTarget.program === 'appleMusic'
            ? 'Apple Music'
            : LIBRARY_NAME[libraryTarget.program],
        format: libraryTarget.format,
        action: copyAction,
        better: libraryTarget.better,
        held: libraryTarget.held,
        keptFormat,
        updatable,
        replaceLosesStars,
      }
    : undefined
  return { copyAction, libraryCopy }
}
