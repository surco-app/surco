import { type DjProgram, writableInOrder } from '../../../shared/djProgram'

export const LIBRARY_NAME: Record<DjProgram, string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine DJ',
  traktor: 'Traktor',
  serato: 'Serato',
}

export const REVIEW_LIBRARIES = writableInOrder(['rekordbox', 'engine', 'traktor']).map(
  (library) => [library, LIBRARY_NAME[library]] as const,
)
