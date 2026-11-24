import { VERSION_GAP_SEC } from '../../../shared/copyVersion'
import type { DjProgram } from '../../../shared/djProgram'
import type { LibraryVerdict } from '../components/LibrarySection'

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

const UNDECIDED: ReadonlySet<LibraryVerdict> = new Set(['measuring', 'unmeasurable'])

// While the comparison runs, or when it cannot run, nothing has ruled out that the copy is
// another edit, which only the verdict would call another version. Until then only a copy of
// the open file's length is filed in the DJ's set.
function lengthsMatch(copyDurationSec: number | undefined, fileDurationSec: number | undefined) {
  if (copyDurationSec === undefined || fileDurationSec === undefined) return false
  return Math.abs(copyDurationSec - fileDurationSec) <= VERSION_GAP_SEC
}

function sameLength(
  row: Pick<CopyRow, 'verdict' | 'durationSec'>,
  fileDurationSec: number | undefined,
): boolean {
  if (row.verdict === null || !UNDECIDED.has(row.verdict)) return true
  return lengthsMatch(row.durationSec, fileDurationSec)
}

export function copyPathIn(
  program: DjProgram,
  rows: readonly CopyRow[],
  fileDurationSec?: number,
): string | undefined {
  return rows.find(
    (row) =>
      row.program === program && countsAsCopy(row.verdict) && sameLength(row, fileDurationSec),
  )?.path
}

export interface FillCandidate {
  path: string
  verdict: LibraryVerdict | null
  durationSec?: number
}

// The first copy decides even when a later one is ready: while it is still being compared it
// may turn out to be another version, whose tags are not this file's, so nothing is read yet.
// Only «same» proves one master. Any other verdict can come from another edit, since the
// comparison calls another version only with both lengths known and a probe that lined up, so
// those copies lend their tags only when their length matches the file's.
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
      (copy.verdict === 'same' || lengthsMatch(copy.durationSec, args.fileDurationSec)),
  )
  if (!first || first.verdict === 'measuring') return ''
  return first.path
}
