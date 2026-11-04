import { type DjProgram, programsInOrder, writableInOrder } from '../../../shared/djProgram'

export const LIBRARY_NAME: Record<DjProgram, string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine DJ',
  traktor: 'Traktor',
  serato: 'Serato',
}

export const REVIEW_LIBRARIES = writableInOrder(['rekordbox', 'engine', 'traktor']).map(
  (library) => [library, LIBRARY_NAME[library]] as const,
)

export const TAG_LIBRARIES = programsInOrder(['rekordbox', 'engine', 'traktor', 'serato']).map(
  (library) => [library, LIBRARY_NAME[library]] as const,
)
