import { useMemo } from 'react'
import type {
  PlaylistEditMode,
  PlaylistTrackRef,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../../../shared/types'

type Edit = (
  edit: RekordboxPlaylistEdit,
  playlistName: string,
  mode?: PlaylistEditMode,
) => Promise<RekordboxEditResult>

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

export function useSessionWrite(edit: Edit): SessionWriter {
  return useMemo(() => {
    const create = async (
      parentId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionWritten | null> => {
      const made = await edit(
        { kind: 'create', parentId, name, folder: false, tracks },
        name,
        'queue',
      )
      if (made.applied) return made.createdId ? { id: made.createdId } : null
      return 'queued' in made ? { queued: made.opId } : null
    }
    const replace = async (
      parentId: string,
      oldId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionWritten | null> => {
      const made = await create(parentId, name, tracks)
      if (made === null) return null
      await edit({ kind: 'delete', playlistId: oldId }, name, 'queue')
      return made
    }
    const fill = async (
      playlistId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<SessionFilled> => {
      const added = await edit({ kind: 'add', playlistId, tracks }, name, 'queue')
      if (added.applied) return 'written'
      return 'queued' in added ? 'queued' : 'refused'
    }
    return { create, replace, fill }
  }, [edit])
}
