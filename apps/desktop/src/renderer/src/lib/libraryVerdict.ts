import type { LibraryVerdict } from '../components/LibrarySection'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'

export function rowVerdict(state: CopyVerdictState): LibraryVerdict | null {
  if (state.measuring) return 'measuring'
  if (!state.verdict || state.verdict.winner === 'tie') return null
  if (state.verdict.winner === 'a') return 'here'
  if (state.verdict.winner === 'b') return 'library'
  return 'same'
}

export function aggregateLibraryVerdict(rows: (LibraryVerdict | null)[]): LibraryVerdict | null {
  for (const verdict of ['library', 'measuring', 'here', 'same'] as const) {
    if (rows.includes(verdict)) return verdict
  }
  return null
}
