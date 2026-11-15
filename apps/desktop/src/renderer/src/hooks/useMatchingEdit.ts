import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxEditResult } from '../../../shared/types'
import { refusalKey } from '../lib/playlistEdits'

export type MatchingAction = 'add' | 'remove'

export function useMatchingEdit(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (
  action: MatchingAction,
  pair: [string, string] | null,
  label: string,
  paths: [string, string] | null,
) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (action, pair, label, paths) => {
      if (paths) {
        const [a, b] = paths
        await (action === 'add'
          ? window.api.addMatchingPair(a, b)
          : window.api.removeMatchingPair(a, b))
        void queryClient.invalidateQueries({ queryKey: ['matching-pairs'] })
      }
      if (!pair) {
        if (action === 'add') notify(tr('sources.matchingSaved'), 'neutral')
        return { applied: true }
      }
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
      notifyResult(result, action === 'add', notify, tr)
      return result
    },
    [queryClient, tr, notify],
  )
}

export interface MatchingStep {
  action: MatchingAction
  pair: [string, string] | null
  label: string
  paths: [string, string] | null
}

export function useMatchingSteps(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (steps: MatchingStep[]) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (steps) => {
      const inRekordbox = steps.some((s) => s.pair)
      let result: RekordboxEditResult = { applied: true }
      try {
        if (inRekordbox) await window.api.dj.askToApply(['rekordbox'])
        for (const { action, pair, label, paths } of steps) {
          if (paths) {
            const [a, b] = paths
            await (action === 'add'
              ? window.api.addMatchingPair(a, b)
              : window.api.removeMatchingPair(a, b))
          }
          if (pair) result = await window.api.dj.match('rekordbox', action, pair, label)
          if (refused(result)) break
        }
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      void queryClient.invalidateQueries({ queryKey: ['matching-pairs'] })
      const adds = steps.some((s) => s.action === 'add')
      if (!inRekordbox) {
        if (adds) notify(tr('sources.matchingSaved'), 'neutral')
        return result
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree', 'rekordbox'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist', 'rekordbox'] }),
      ])
      notifyResult(result, adds, notify, tr)
      return result
    },
    [queryClient, tr, notify],
  )
}

function refused(result: RekordboxEditResult): boolean {
  return !result.applied && !('queued' in result) && result.reason !== 'nothing-to-add'
}

function notifyResult(
  result: RekordboxEditResult,
  added: boolean,
  notify: (text: string, tone: 'neutral' | 'danger') => void,
  tr: (key: string) => string,
): void {
  if (!result.applied && 'queued' in result) notify(tr(refusalKey('cancelled')), 'neutral')
  else if (!result.applied && result.reason !== 'nothing-to-add')
    notify(
      tr(refusalKey(result.reason)),
      result.reason === 'cancelled' || result.reason === 'rekordbox-running' ? 'neutral' : 'danger',
    )
  else if (result.applied && added) notify(tr('sources.matchingAdded'), 'neutral')
}
