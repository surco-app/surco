import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxQueueApplied, RekordboxQueueState } from '../../../shared/types'
import { appliedMessage } from '../lib/rekordboxQueueText'

const NOTHING: RekordboxQueueState = { tracks: 0, changes: 0, items: [] }

export function useRekordboxQueue(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
  onDiscarded: (paths: string[]) => void,
): { state: RekordboxQueueState; applyNow: () => Promise<void>; discard: () => Promise<void> } {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  const [state, setState] = useState<RekordboxQueueState>(NOTHING)

  useEffect(() => {
    let live = true
    void window.api.rekordboxQueue().then((s) => {
      if (live) setState(s)
    })
    const off = window.api.onRekordboxQueueChanged(setState)
    return () => {
      live = false
      off()
    }
  }, [])

  const reread = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rekordbox-membership'] }),
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
      ]),
    [queryClient],
  )

  const announce = useCallback(
    (applied: RekordboxQueueApplied | null) => {
      if (!applied) return
      const message = appliedMessage(tr, applied)
      if (message) notify(message.text, message.tone)
      void reread()
    },
    [tr, notify, reread],
  )

  useEffect(() => window.api.onRekordboxQueueApplied(announce), [announce])

  const applyNow = useCallback(async () => {
    announce(await window.api.applyRekordboxQueue())
  }, [announce])

  const discard = useCallback(async () => {
    const paths = state.items.flatMap((i) =>
      i.key.startsWith('track:') ? [i.key.slice('track:'.length)] : [],
    )
    await window.api.discardRekordboxQueue()
    onDiscarded(paths)
    void reread()
  }, [state, onDiscarded, reread])

  return { state, applyNow, discard }
}
