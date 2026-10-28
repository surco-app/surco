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
  source: 'rekordbox' | 'traktor' = 'rekordbox',
): (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (edit, playlistName) => {
      if (edit.kind === 'move') {
        const key = ['source-playlist', source, edit.playlistId]
        // A re-read already in flight (a refocus) carries the order from before the move
        // and would land over it; it is dropped, and the re-read after the write replaces it.
        void queryClient.cancelQueries({ queryKey: key })
        queryClient.setQueryData<SourcePlaylistEntry[]>(
          key,
          (prev) => prev && movedEntries(prev, edit.linkIds, edit.beforeLinkId),
        )
      }
      let result: RekordboxEditResult
      try {
        result =
          source === 'traktor'
            ? await window.api.editTraktorPlaylist(edit, playlistName)
            : await window.api.editRekordboxPlaylist(edit, playlistName)
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['source-separator'] }),
        queryClient.invalidateQueries({ queryKey: ['rekordbox-membership'] }),
        queryClient.invalidateQueries({ queryKey: ['traktor-membership'] }),
      ])
      const message = editMessage(tr, edit, result, playlistName, source)
      if (message) notify(message.text, message.tone)
      return result
    },
    [queryClient, tr, notify, source],
  )
}
