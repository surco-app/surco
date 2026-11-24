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

export function copyPathIn(
  program: DjProgram,
  rows: readonly { program: DjProgram; path: string; verdict: LibraryVerdict | null }[],
): string | undefined {
  return rows.find((row) => row.program === program && countsAsCopy(row.verdict))?.path
}
