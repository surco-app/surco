import type { LibraryVerdict } from '../components/LibrarySection'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import type { CopyVerdict } from './bestCopy'

export function verdictState(verdict: CopyVerdict | null, measuring: boolean): LibraryVerdict {
  if (measuring) return 'measuring'
  if (!verdict) return 'unmeasurable'
  if (verdict.winner === 'a') return 'here'
  if (verdict.winner === 'b') return 'library'
  // One master that nothing measured separates is, for a DJ, the same track at the same
  // quality, whether or not the files are identical byte for byte.
  if (verdict.winner === 'tie') return verdict.sameMaster ? 'same' : 'even'
  return verdict.winner
}

export function rowVerdict(state: CopyVerdictState): LibraryVerdict {
  if (state.missing) return 'missing'
  if (state.unreadable) return 'unreadable'
  if (state.checking) return 'measuring'
  return verdictState(state.verdict, state.measuring)
}

export function aggregateLibraryVerdict(rows: (LibraryVerdict | null)[]): LibraryVerdict | null {
  for (const verdict of [
    'library',
    'measuring',
    'here',
    'different',
    'missing',
    'unreadable',
    'unmeasurable',
    'even',
    'same',
    'thisFile',
  ] as const) {
    if (rows.includes(verdict)) return verdict
  }
  return null
}
