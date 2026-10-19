import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
  RekordboxQueueNotice,
} from '../shared/types'
import { withNodeTimestamp } from './rekordboxMasterXml'

export interface EditOp {
  id: string
  kind: 'edit'
  edit: RekordboxPlaylistEdit
  stamps: Record<string, number>
}

export type QueueOp = EditOp

export interface OpOutcome {
  id: string
  applied: boolean
  reason?: RekordboxEditRefusal
  report?: PlaylistAddReport
  createdId?: string
  notices: RekordboxQueueNotice[]
}

export type BatchResult =
  | { ok: true; wrote: boolean; outcomes: OpOutcome[] }
  | { ok: false; reason: RekordboxEditRefusal }

const EDIT_RANK: Record<RekordboxPlaylistEdit['kind'], number> = {
  create: 1,
  add: 2,
  move: 2,
  remove: 2,
  insertSeparator: 2,
  rename: 3,
  delete: 5,
}

export function opRank(op: QueueOp): number {
  return EDIT_RANK[op.edit.kind]
}

export interface XmlDraft {
  xml: string | null
  taken: Set<string>
  now: number
}

export function bumpNode(draft: XmlDraft, playlistId: string): void {
  if (draft.xml !== null) draft.xml = withNodeTimestamp(draft.xml, playlistId, draft.now)
}
