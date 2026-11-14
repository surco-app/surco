import type { CueProgram, DjProgram } from './djProgram'
import type {
  CollectionTrack,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxQueueApplied,
  RekordboxQueueState,
  RekordboxSyncIssue,
  SourceNode,
  SourcePlaylistEntry,
} from './types'

export type ApplyAnswer = 'now' | 'later'

type Awaitable<T> = T | Promise<T>

export interface DjReadMain {
  available(): Awaitable<boolean>
  tree(): Awaitable<SourceNode[]>
  recentCount(): Awaitable<number>
  trackCount(): Awaitable<number>
  playlist(id: string): Awaitable<SourcePlaylistEntry[]>
  membership(paths: string[]): Awaitable<Record<string, string[]>>
  collection?(): Awaitable<CollectionTrack[]>
  matching?(): Awaitable<[string, string][]>
}

export interface DjEditMain {
  save(edit: RekordboxPlaylistEdit, label: string | undefined): Promise<RekordboxEditResult>
  hasSeparator?(): Awaitable<boolean>
}

export interface DjCueQueueMain {
  read(): Awaitable<RekordboxQueueState>
  apply(): Promise<RekordboxQueueApplied | null>
  discard(): Promise<void> | void
  ready(): Awaitable<void>
}

export interface DjExportPayload {
  rekordbox: string
  traktor: string
  serato: { inputPath: string; outputPath?: string }[]
}

export type ExportProgram = keyof DjExportPayload

export interface DjMainProgram {
  read: DjReadMain
  edit?: DjEditMain
  cueQueue?: DjCueQueueMain
  exportCollection?(payload: never): Promise<string | null>
  pickLibraryPath?(): Promise<string | null>
  running?(): Promise<boolean>
}

export type DjMainTable = Record<DjProgram, DjMainProgram>

export const DJ_CUE_QUEUE_CHANGED = 'dj:cueQueueChanged'
export const DJ_CUE_QUEUE_APPLIED = 'dj:cueQueueApplied'
export const DJ_SYNC_ISSUE = 'dj:syncIssue'

export interface DjEvent<T> {
  program: DjProgram
  value: T
}

export interface DjApi {
  available(p: DjProgram): Promise<boolean>
  tree(p: DjProgram): Promise<SourceNode[]>
  recentCount(p: DjProgram): Promise<number>
  trackCount(p: DjProgram): Promise<number>
  playlist(p: DjProgram, id: string): Promise<SourcePlaylistEntry[]>
  membership(p: DjProgram, paths: string[]): Promise<Record<string, string[]>>
  collection(p: DjProgram): Promise<CollectionTrack[]>
  matching(p: DjProgram): Promise<[string, string][]>
  editPlaylist(
    p: DjProgram,
    edit: RekordboxPlaylistEdit,
    label?: string,
  ): Promise<RekordboxEditResult>
  hasSeparator(p: DjProgram): Promise<boolean>
  cueQueue(p: DjProgram): Promise<RekordboxQueueState>
  applyCueQueue(p: DjProgram): Promise<RekordboxQueueApplied | null>
  discardCueQueue(p: DjProgram): Promise<void>
  cueQueueReady(p: DjProgram): Promise<void>
  onCueQueueChanged(p: DjProgram, cb: (state: RekordboxQueueState) => void): () => void
  onCueQueueApplied(p: DjProgram, cb: (applied: RekordboxQueueApplied) => void): () => void
  exportCollection<P extends ExportProgram>(
    p: P,
    payload: DjExportPayload[P],
  ): Promise<string | null>
  pickLibraryPath(p: DjProgram): Promise<string | null>
  running(p: DjProgram): Promise<boolean>
  askToApply(programs: CueProgram[]): Promise<Partial<Record<CueProgram, ApplyAnswer>>>
  onSyncIssue(p: DjProgram, cb: (issue: RekordboxSyncIssue) => void): () => void
}
