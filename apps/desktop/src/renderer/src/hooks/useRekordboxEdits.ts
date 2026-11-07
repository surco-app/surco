import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DJ_PROGRAMS, type DjProgram } from '../../../shared/djProgram'
import type {
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'
import { markOwnRemovals, takeOwnRemoval } from '../lib/ownRemovals'
import { editMessage, editedTree, movedEntries, subtreeIds } from '../lib/playlistEdits'
import { SOURCE_PROGRAMS } from '../lib/sourcePrograms'

// Sends one edit to rekordbox and then re-reads what rekordbox holds: the collection is the
// only truth, so the tree, the open playlist and the separator check are fetched again
// whatever the answer. A move and the tree edits (create, rename, delete, moveNode) are drawn
// before the answer (the dragged row must not snap back during the write); the re-read
// corrects them if the write was refused.
export function useRekordboxEdits(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
  source: DjProgram = 'rekordbox',
): (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (edit, playlistName) => {
      const sourceEdit = SOURCE_PROGRAMS[source].edit
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
      const treeKey = ['source-tree', source]
      const { crates } = SOURCE_PROGRAMS[source]
      let markedIds: string[] = []
      void queryClient.cancelQueries({ queryKey: treeKey })
      queryClient.setQueryData<SourceNode[]>(treeKey, (prev) => {
        if (!prev) return prev
        if (edit.kind === 'delete' || (edit.kind === 'moveNode' && crates)) {
          markedIds = subtreeIds(prev, edit.playlistId)
          markOwnRemovals(markedIds)
        }
        return editedTree(prev, edit, { crates }) ?? prev
      })
      let result: RekordboxEditResult
      try {
        result = sourceEdit
          ? await sourceEdit.save(edit, playlistName)
          : { applied: false, reason: 'read-only' }
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['source-separator'] }),
        ...DJ_PROGRAMS.filter((p) => SOURCE_PROGRAMS[p].invalidatesOnEdit).map((p) =>
          queryClient.invalidateQueries({ queryKey: [SOURCE_PROGRAMS[p].membershipKey] }),
        ),
      ])
      for (const id of markedIds) takeOwnRemoval(id)
      const message = editMessage(tr, edit, result, playlistName, sourceEdit?.messagePrefix)
      if (message) notify(message.text, message.tone)
      return result
    },
    [queryClient, tr, notify, source],
  )
}
