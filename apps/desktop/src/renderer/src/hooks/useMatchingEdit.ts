import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxEditResult } from '../../../shared/types'
import { refusalKey } from '../lib/playlistEdits'

export type MatchingAction = 'add' | 'remove'

export function useMatchingEdit(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (action: MatchingAction, pair: [string, string], label: string) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (action, pair, label) => {
      let result: RekordboxEditResult
      try {
        await window.api.dj.askToApply(['rekordbox'])
        result = await window.api.dj.match('rekordbox', action, pair, label)
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree', 'rekordbox'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist', 'rekordbox'] }),
      ])
      if (!result.applied && 'queued' in result) notify(tr(refusalKey('cancelled')), 'neutral')
      else if (!result.applied && result.reason !== 'nothing-to-add')
        notify(
          tr(refusalKey(result.reason)),
          result.reason === 'cancelled' || result.reason === 'rekordbox-running'
            ? 'neutral'
            : 'danger',
        )
      else if (result.applied && action === 'add') notify(tr('sources.matchingAdded'), 'neutral')
      return result
    },
    [queryClient, tr, notify],
  )
}
