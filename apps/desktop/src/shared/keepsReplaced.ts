import type { WritableProgram } from './djProgram'

export const KEEPS_REPLACED: Record<WritableProgram, boolean> = {
  rekordbox: true,
  engine: true,
  traktor: false,
  virtualdj: false,
}
