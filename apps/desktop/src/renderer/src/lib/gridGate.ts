import { programOf } from '../../../shared/djProgram'
import type { EditableGrid } from '../../../shared/gridEdit'
import { type CueProgram, cueProgramOf } from './cuePrograms'

export type GridGateKey =
  | NonNullable<CueProgram['fixedGrid']>
  | 'editor.cues.grid.unmeasured'
  | 'editor.cues.grid.provisional'
  | 'editor.cues.grid.surcoDraft'
  | 'editor.cues.grid.varying'

export function gridGate(input: {
  contentId: string
  read: { analysed: boolean; clockLeadMs?: number | null }
  grid: EditableGrid | null
  onSurcoGrid: boolean
}): GridGateKey | null {
  const { contentId, read, grid, onSurcoGrid } = input
  const rekordboxGrid = programOf(contentId) === 'rekordbox'
  const { fixedGrid } = cueProgramOf(contentId)
  if (fixedGrid) return fixedGrid
  if (!rekordboxGrid && (read.clockLeadMs === undefined || read.clockLeadMs === null))
    return 'editor.cues.grid.unmeasured'
  if (!read.analysed) return 'editor.cues.grid.provisional'
  if (onSurcoGrid) return 'editor.cues.grid.surcoDraft'
  if (grid === null || (!rekordboxGrid && grid.zones)) return 'editor.cues.grid.varying'
  return null
}
