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
  const run = useMatchingRun(notify)
  return useCallback(
    (action, edits) => {
      const steps = edits.map((edit) => ({ action, ...edit }))
      const inRekordbox = steps.filter((s) => s.pair)
      let written: Promise<RekordboxEditResult[]> | null = null
      return run(steps, async (step) => {
        written ??= window.api.dj.matchAll(
          'rekordbox',
          action,
          inRekordbox.map(({ pair, label }) => ({ pair: pair as [string, string], label })),
        )
        return (await written)[inRekordbox.indexOf(step)]
      })
    },
    [run],
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
  const run = useMatchingRun(notify)
  return useCallback(
    (steps) =>
      run(steps, ({ action, pair, label }) =>
        window.api.dj.match('rekordbox', action, pair as [string, string], label),
      ),
    [run],
  )
}

function useMatchingRun(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (
  steps: MatchingStep[],
  write: (step: MatchingStep) => Promise<RekordboxEditResult>,
) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (steps, write) => {
      const inRekordbox = steps.some((s) => s.pair)
      let result: RekordboxEditResult = { applied: true }
      let telling: RekordboxEditResult | null = null
      try {
        if (inRekordbox) await window.api.dj.askToApply(['rekordbox'])
        for (const step of steps) {
          const { action, paths } = step
          if (step.pair) result = await write(step)
          if (!telling && notable(result)) telling = result
          if (refused(result)) break
          if (paths) {
            const [a, b] = paths
            await (action === 'add'
              ? window.api.addMatchingPair(a, b)
              : window.api.removeMatchingPair(a, b))
          }
        }
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      result = telling ?? result
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

function notable(result: RekordboxEditResult): boolean {
  return !result.applied && ('queued' in result || result.reason !== 'nothing-to-add')
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

export function useMatchingEdit(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (
  action: MatchingAction,
  pair: [string, string] | null,
  label: string,
  paths: [string, string] | null,
) => Promise<RekordboxEditResult> {
  const runSteps = useMatchingSteps(notify)
  return useCallback(
    (action, pair, label, paths) => runSteps([{ action, pair, label, paths }]),
    [runSteps],
  )
}
