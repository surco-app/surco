import type { WantedCue } from '../shared/cueRules'
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
import type { RekordboxMeta } from './rekordboxMetadata'
import type { SeratoTagField } from './seratoDatabaseWrite'

export interface CrateStamp {
  tracks: string[]
}

export interface EditOp {
  id: string
  kind: 'edit'
  edit: RekordboxPlaylistEdit
  stamps: Record<string, number>
  label?: string
  files?: Record<string, CrateStamp | null>
}

export interface TrackOp {
  id: string
  kind: 'track'
  path: string
  from?: string
  label: string
  contentId?: string
  facts: ContentFacts | null
  meta?: RekordboxMeta
  wanted: RekordboxPlaylistTarget[]
  known: string[]
  stamps: Record<string, number>
  add?: true
}

export interface CuesOp extends Omit<SaveCuesRequest, 'wanted'> {
  id: string
  kind: 'cues'
  wanted?: WantedCue[]
  drops?: number[]
  previousDrops?: number[]
  notices?: RekordboxQueueNotice[]
}

export interface TagsOp {
  id: string
  kind: 'tags'
  path: string
  label: string
  fields: Partial<Record<SeratoTagField, string>>
  from?: Partial<Record<SeratoTagField, string>>
}

export interface MatchOp {
  id: string
  kind: 'match'
  action: 'add' | 'remove'
  pair: [string, string]
  label: string
}

export type QueueOp = EditOp | TrackOp | CuesOp | TagsOp | MatchOp

export interface OpOutcome {
  id: string
  applied: boolean
  reason?: RekordboxEditRefusal
  report?: PlaylistAddReport
  createdId?: string
  contentId?: string
  uncounted?: true
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
  moveNode: 3,
  delete: 5,
}

export function opRank(op: QueueOp): number {
  if (op.kind === 'track') return 0
  if (op.kind === 'tags') return 1
  if (op.kind === 'cues') return 4
  if (op.kind === 'match') return 2
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
  return {
    applied: true,
    ...(outcome.createdId ? { createdId: outcome.createdId } : {}),
    ...(outcome.report ? { report: outcome.report } : {}),
  }
}
