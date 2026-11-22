import type { LibraryVerdict } from '../components/LibrarySection'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import type { CopyVerdict } from './bestCopy'

export function verdictState(
  verdict: CopyVerdict | null,
  measuring: boolean,
): LibraryVerdict | null {
  if (measuring) return 'measuring'
  if (!verdict) return null
  if (verdict.winner === 'a') return 'here'
  if (verdict.winner === 'b') return 'library'
  if (verdict.winner === 'tie' && !verdict.sameMaster) return null
  return verdict.winner
}

export function rowVerdict(state: CopyVerdictState): LibraryVerdict | null {
  return verdictState(state.verdict, state.measuring)
}

export function aggregateLibraryVerdict(rows: (LibraryVerdict | null)[]): LibraryVerdict | null {
  for (const verdict of ['library', 'measuring', 'here', 'different', 'tie', 'same'] as const) {
    if (rows.includes(verdict)) return verdict
  }
  return null
}
