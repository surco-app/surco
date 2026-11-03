import { type DjProgram, programsInOrder } from '../../../shared/djProgram'

export const LIBRARY_NAME: Record<DjProgram, string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine DJ',
  traktor: 'Traktor',
}

export const REVIEW_LIBRARIES = programsInOrder(['rekordbox', 'engine', 'traktor']).map(
  (library) => [library, LIBRARY_NAME[library]] as const,
)
