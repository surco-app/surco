import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxPlaylistTarget,
  RekordboxQueueNotice,
  SaveCuesRequest,
} from '../shared/types'
import type { ContentFacts } from './rekordboxContentAdd'
import { withNodeTimestamp } from './rekordboxMasterXml'

export interface EditOp {
  id: string
  kind: 'edit'
  edit: RekordboxPlaylistEdit
  stamps: Record<string, number>
  label?: string
}

export interface TrackOp {
  id: string
  kind: 'track'
  path: string
  label: string
  contentId?: string
  facts: ContentFacts | null
  wanted: RekordboxPlaylistTarget[]
  known: string[]
  stamps: Record<string, number>
}

export interface CuesOp extends SaveCuesRequest {
  id: string
  kind: 'cues'
}

export type QueueOp = EditOp | TrackOp | CuesOp

export interface OpOutcome {
  id: string
  applied: boolean
  reason?: RekordboxEditRefusal
  report?: PlaylistAddReport
  createdId?: string
  contentId?: string
  notices: RekordboxQueueNotice[]
}

export type BatchResult =
  | { ok: true; wrote: boolean; outcomes: OpOutcome[] }
  | { ok: false; reason: RekordboxEditRefusal }

const EDIT_RANK: Record<RekordboxPlaylistEdit['kind'], number> = {
  create: -1,
  add: 2,
  move: 2,
  remove: 2,
  insertSeparator: 2,
  rename: 3,
  delete: 5,
}

export function opRank(op: QueueOp): number {
  if (op.kind === 'track') return 0
  if (op.kind === 'cues') return 4
  return EDIT_RANK[op.edit.kind]
}

export interface XmlDraft {
  xml: string | null
  taken: Set<string>
  created: Map<string, string>
  now: number
}

export function bumpNode(draft: XmlDraft, playlistId: string): void {
  if (draft.xml !== null) draft.xml = withNodeTimestamp(draft.xml, playlistId, draft.now)
}

export function editResultOfOutcome(outcome: OpOutcome | undefined): RekordboxEditResult {
  if (!outcome) return { applied: false, reason: 'write-failed' }
  if (!outcome.applied) {
    const reason = outcome.reason ?? 'write-failed'
    return outcome.report
      ? { applied: false, reason, report: outcome.report }
      : { applied: false, reason }
  }
  if (outcome.report) return { applied: true, report: outcome.report }
  return outcome.createdId ? { applied: true, createdId: outcome.createdId } : { applied: true }
}
