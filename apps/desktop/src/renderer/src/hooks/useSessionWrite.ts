import { useMemo } from 'react'
import type {
  PlaylistTrackRef,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../../../shared/types'

type Edit = (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult>

export interface SessionWriter {
  fill(playlistId: string, name: string, tracks: PlaylistTrackRef[]): Promise<boolean>
  create(parentId: string, name: string, tracks: PlaylistTrackRef[]): Promise<string | null>
  replace(
    parentId: string,
    oldId: string,
    name: string,
    tracks: PlaylistTrackRef[],
  ): Promise<string | null>
}

export function useSessionWrite(edit: Edit): SessionWriter {
  return useMemo(() => {
    const create = async (
      parentId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<string | null> => {
      const made = await edit({ kind: 'create', parentId, name, folder: false }, name)
      if (!made.applied || !made.createdId) return null
      const filled = await edit({ kind: 'add', playlistId: made.createdId, tracks }, name)
      if (filled.applied) return made.createdId
      await edit({ kind: 'delete', playlistId: made.createdId }, name)
      return null
    }
    const replace = async (
      parentId: string,
      oldId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<string | null> => {
      const id = await create(parentId, name, tracks)
      if (id === null) return null
      await edit({ kind: 'delete', playlistId: oldId }, name)
      return id
    }
    const fill = async (
      playlistId: string,
      name: string,
      tracks: PlaylistTrackRef[],
    ): Promise<boolean> => (await edit({ kind: 'add', playlistId, tracks }, name)).applied
    return { create, replace, fill }
  }, [edit])
}
