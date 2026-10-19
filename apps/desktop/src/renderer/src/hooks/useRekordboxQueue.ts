import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RekordboxQueueApplied,
  RekordboxQueueState,
  RekordboxQueueWritten,
} from '../../../shared/types'
import { refusalKey } from '../lib/playlistEdits'
import { appliedMessage } from '../lib/rekordboxQueueText'

const NOTHING: RekordboxQueueState = { tracks: 0, changes: 0, items: [] }

export function useRekordboxQueue(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
  onDiscarded: (paths: string[]) => void,
  onWritten: (written: RekordboxQueueWritten[]) => void,
): { state: RekordboxQueueState; applyNow: () => Promise<void>; discard: () => Promise<void> } {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  const [state, setState] = useState<RekordboxQueueState>(NOTHING)

  useEffect(() => {
    let live = true
    let pushed = false
    void window.api
      .rekordboxQueue()
      .then((s) => {
        if (live && !pushed) setState(s)
      })
      .catch((e: unknown) => {
        window.api.logError(
          `rekordbox queue: first read failed (${e instanceof Error ? e.message : String(e)})`,
        )
      })
    const off = window.api.onRekordboxQueueChanged((s) => {
      pushed = true
      setState(s)
    })
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
      if ('written' in applied) onWritten(applied.written)
      void reread()
    },
    [tr, notify, reread, onWritten],
  )

  useEffect(() => window.api.onRekordboxQueueApplied(announce), [announce])

  useEffect(() => {
    void window.api.rekordboxQueueReady().catch(() => undefined)
  }, [])

  const applyNow = useCallback(async () => {
    try {
      announce(await window.api.applyRekordboxQueue())
    } catch {
      notify(tr(refusalKey('write-failed')), 'danger')
    }
  }, [announce, notify, tr])

  const discard = useCallback(async () => {
    const paths = state.items.flatMap((i) =>
      i.key.startsWith('track:') ? [i.key.slice('track:'.length)] : [],
    )
    try {
      await window.api.discardRekordboxQueue()
    } catch {
      notify(tr(refusalKey('write-failed')), 'danger')
      return
    }
    onDiscarded(paths)
    void reread()
  }, [state, onDiscarded, reread, notify, tr])

  return { state, applyNow, discard }
}
