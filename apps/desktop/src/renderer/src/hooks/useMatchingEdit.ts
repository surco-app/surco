import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxEditResult } from '../../../shared/types'
import { refusalKey } from '../lib/playlistEdits'

export type MatchingAction = 'add' | 'remove'

export interface MatchingEdit {
  pair: [string, string] | null
  label: string
  paths: [string, string] | null
}

export function useMatchingEdits(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (action: MatchingAction, edits: MatchingEdit[]) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (action, edits) => {
      for (const { paths } of edits) {
        if (!paths) continue
        const [a, b] = paths
        await (action === 'add'
          ? window.api.addMatchingPair(a, b)
          : window.api.removeMatchingPair(a, b))
      }
      if (edits.some((e) => e.paths))
        void queryClient.invalidateQueries({ queryKey: ['matching-pairs'] })
      const written = edits.flatMap((e) => (e.pair ? [{ pair: e.pair, label: e.label }] : []))
      if (written.length === 0) {
        if (action === 'add') notify(tr('sources.matchingSaved'), 'neutral')
        return { applied: true }
      }
      const results: RekordboxEditResult[] = []
      try {
        await window.api.dj.askToApply(['rekordbox'])
        for (const { pair, label } of written)
          results.push(await window.api.dj.match('rekordbox', action, pair, label))
      } catch {
        results.push({ applied: false, reason: 'write-failed' })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree', 'rekordbox'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist', 'rekordbox'] }),
      ])
      const result =
        results.find((r) => !r.applied && ('queued' in r || r.reason !== 'nothing-to-add')) ??
        results[0]
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

export function useMatchingEdit(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (
  action: MatchingAction,
  pair: [string, string] | null,
  label: string,
  paths: [string, string] | null,
) => Promise<RekordboxEditResult> {
  const editAll = useMatchingEdits(notify)
  return useCallback(
    (action, pair, label, paths) => editAll(action, [{ pair, label, paths }]),
    [editAll],
  )
}
