import type { DjProgram } from '../../shared/djProgram'
import { engineLibrary } from './engine'
import { rekordboxLibrary } from './rekordbox'
import { seratoLibrary } from './serato'
import type { TestLibrary } from './testLibrary'
import { traktorLibrary } from './traktor'
import { virtualdjLibrary } from './virtualdj'

export const TEST_LIBRARIES: Record<DjProgram, TestLibrary> = {
  rekordbox: rekordboxLibrary,
  traktor: traktorLibrary,
  engine: engineLibrary,
  serato: seratoLibrary,
  virtualdj: virtualdjLibrary,
}
