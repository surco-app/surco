import type { DjProgram } from '../../../shared/djProgram'
import type { LibraryVerdict } from '../components/LibrarySection'

const COPY_VERDICTS: ReadonlySet<LibraryVerdict> = new Set([
  'same',
  'even',
  'tie',
  'here',
  'library',
  'unmeasurable',
  // La copia ya se encontró, solo falta saber cuál de las dos es mejor.
  'measuring'
])

// 'several' queda fuera: con varias copias empatadas Surco no sabe cuál es la pista.
export function countsAsCopy(verdict: LibraryVerdict | null | undefined): boolean {
  return verdict != null && COPY_VERDICTS.has(verdict)
}

export function copyPathIn(
  program: DjProgram,
  rows: readonly { program: DjProgram; path: string; verdict: LibraryVerdict | null }[]
): string | undefined {
  return rows.find((row) => row.program === program && countsAsCopy(row.verdict))?.path
}
