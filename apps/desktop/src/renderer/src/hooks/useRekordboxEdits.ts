import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourcePlaylistEntry,
} from '../../../shared/types'
import { editMessage, movedEntries } from '../lib/playlistEdits'

// Sends one edit to rekordbox and then re-reads what rekordbox holds: the collection is the
// only truth, so the tree, the open playlist and the separator check are fetched again
// whatever the answer. Only a move is drawn before the answer (the dragged row must not
// snap back during the write); the re-read corrects it if the write was refused.
export function useRekordboxEdits(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (edit, playlistName) => {
      if (edit.kind === 'move')
        queryClient.setQueryData<SourcePlaylistEntry[]>(
          ['source-playlist', 'rekordbox', edit.playlistId],
          (prev) => prev && movedEntries(prev, edit.linkIds, edit.beforeLinkId),
        )
      let result: RekordboxEditResult
      try {
        result = await window.api.editRekordboxPlaylist(edit)
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['source-separator'] }),
      ])
      const message = editMessage(tr, edit, result, playlistName)
      if (message) notify(message.text, message.tone)
      return result
    },
    [queryClient, tr, notify],
  )
}
