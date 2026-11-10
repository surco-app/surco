import type { DjProgram } from './djProgram'
import type { CollectionTrack, SourceNode, SourcePlaylistEntry } from './types'

type Awaitable<T> = T | Promise<T>

export interface DjReadMain {
  available(): Awaitable<boolean>
  tree(): Awaitable<SourceNode[]>
  recentCount(): Awaitable<number>
  trackCount(): Awaitable<number>
  playlist(id: string): Awaitable<SourcePlaylistEntry[]>
  membership(paths: string[]): Awaitable<Record<string, string[]>>
  collection?(): Awaitable<CollectionTrack[]>
}

export interface DjMainProgram {
  read: DjReadMain
}

export type DjMainTable = Record<DjProgram, DjMainProgram>

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
}
