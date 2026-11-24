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

// The first copy decides even when a later one is ready: while it is still being compared it
// may turn out to be another version, whose tags are not this file's, so nothing is read yet.
export function fillCopyPath(args: {
  musicCopyPath: string
  musicCopyPending: boolean
  programs: readonly FillCandidate[]
  fileDurationSec: number | undefined
}): string {
  if (args.musicCopyPath) return args.musicCopyPath
  if (args.musicCopyPending) return ''
  const first = args.programs.find(
    (copy) => countsAsCopy(copy.verdict) && lengthsMatch(copy.durationSec, args.fileDurationSec),
  )
  if (!first || first.verdict === 'measuring') return ''
  return first.path
}
