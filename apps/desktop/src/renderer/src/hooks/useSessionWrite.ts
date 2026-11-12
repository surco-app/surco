import { useMemo } from 'react'
import type { DjProgram } from '../../../shared/djProgram'
import type {
  PlaylistTrackRef,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../../../shared/types'

type Edit = (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult>

export type SessionWritten = { id: string } | { queued: string }

export type SessionFilled = 'written' | 'queued' | 'refused'

export interface SessionWriter {
  fill(playlistId: string, name: string, tracks: PlaylistTrackRef[]): Promise<SessionFilled>
  create(parentId: string, name: string, tracks: PlaylistTrackRef[]): Promise<SessionWritten | null>
  replace(
    parentId: string,
    oldId: string,
    name: string,
    tracks: PlaylistTrackRef[],
  ): Promise<SessionWritten | null>
}

export function useSessionWrite(edit: Edit, program: DjProgram): SessionWriter {
  return useMemo(() => {
    const ask = () => window.api.dj.askToApply([program])
    const write = async (
      parentId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionWritten | null> => {
      const made = await edit({ kind: 'create', parentId, name, folder: false, tracks }, name)
      if (made.applied) return made.createdId ? { id: made.createdId } : null
      return 'queued' in made ? { queued: made.opId } : null
    }
    const create = async (
      parentId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionWritten | null> => {
      await ask()
      return write(parentId, name, tracks)
    }
    const replace = async (
      parentId: string,
      oldId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionWritten | null> => {
      await ask()
      const made = await write(parentId, name, tracks)
      if (made === null) return null
      await edit({ kind: 'delete', playlistId: oldId }, name)
      return made
    }
    const fill = async (
      playlistId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionFilled> => {
      await ask()
      const added = await edit({ kind: 'add', playlistId, tracks }, name)
      if (added.applied) return 'written'
      return 'queued' in added ? 'queued' : 'refused'
    }
    return { create, replace, fill }
  }, [edit, program])
}
