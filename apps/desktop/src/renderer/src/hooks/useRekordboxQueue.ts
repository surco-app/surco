import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type CueProgram, DJ_PROGRAMS } from '../../../shared/djProgram'
import type {
  RekordboxQueueApplied,
  RekordboxQueueState,
  RekordboxQueueWritten,
} from '../../../shared/types'
import {
  appliedMessage,
  type CueSpot,
  ENGINE_QUEUE_WORDS,
  type QueueWords,
  REKORDBOX_QUEUE_WORDS,
  SERATO_QUEUE_WORDS,
  TRAKTOR_QUEUE_WORDS,
} from '../lib/rekordboxQueueText'
import { SOURCE_PROGRAMS } from '../lib/sourcePrograms'

const NOTHING: RekordboxQueueState = { tracks: 0, changes: 0, items: [] }

export interface QueueSource {
  name: string
  read: () => Promise<RekordboxQueueState>
  onChanged: (cb: (state: RekordboxQueueState) => void) => () => void
  onApplied: (cb: (applied: RekordboxQueueApplied) => void) => () => void
  ready: () => Promise<void>
  applyNow: () => Promise<RekordboxQueueApplied | null>
  discard: () => Promise<void>
  words: QueueWords
}

export const REKORDBOX_QUEUE: QueueSource = {
  name: 'rekordbox queue',
  read: () => window.api.rekordboxQueue(),
  onChanged: (cb) => window.api.onRekordboxQueueChanged(cb),
  onApplied: (cb) => window.api.onRekordboxQueueApplied(cb),
  ready: () => window.api.rekordboxQueueReady(),
  applyNow: () => window.api.applyRekordboxQueue(),
  discard: () => window.api.discardRekordboxQueue(),
  words: REKORDBOX_QUEUE_WORDS,
}

export const ENGINE_CUE_QUEUE: QueueSource = {
  name: 'Engine DJ cue queue',
  read: () => window.api.engineCueQueue(),
  onChanged: (cb) => window.api.onEngineCueQueueChanged(cb),
  onApplied: (cb) => window.api.onEngineCueQueueApplied(cb),
  ready: () => window.api.engineCueQueueReady(),
  applyNow: () => window.api.applyEngineCueQueue(),
  discard: () => window.api.discardEngineCueQueue(),
  words: ENGINE_QUEUE_WORDS,
}

export const TRAKTOR_CUE_QUEUE: QueueSource = {
  name: 'Traktor cue queue',
  read: () => window.api.traktorCueQueue(),
  onChanged: (cb) => window.api.onTraktorCueQueueChanged(cb),
  onApplied: (cb) => window.api.onTraktorCueQueueApplied(cb),
  ready: () => window.api.traktorCueQueueReady(),
  applyNow: () => window.api.applyTraktorCueQueue(),
  discard: () => window.api.discardTraktorCueQueue(),
  words: TRAKTOR_QUEUE_WORDS,
}

export const SERATO_CUE_QUEUE: QueueSource = {
  name: 'Serato cue queue',
  read: () => window.api.seratoCueQueue(),
  onChanged: (cb) => window.api.onSeratoCueQueueChanged(cb),
  onApplied: (cb) => window.api.onSeratoCueQueueApplied(cb),
  ready: () => window.api.seratoCueQueueReady(),
  applyNow: () => window.api.applySeratoCueQueue(),
  discard: () => window.api.discardSeratoCueQueue(),
  words: SERATO_QUEUE_WORDS,
}

export const PROGRAM_QUEUES: Record<CueProgram, { source: QueueSource; testid: string }> = {
  rekordbox: { source: REKORDBOX_QUEUE, testid: 'rekordbox-queue' },
  engine: { source: ENGINE_CUE_QUEUE, testid: 'engine-queue' },
  traktor: { source: TRAKTOR_CUE_QUEUE, testid: 'traktor-queue' },
  serato: { source: SERATO_CUE_QUEUE, testid: 'serato-queue' },
}

export function useRekordboxQueue(
  notify: (text: string, tone: 'neutral' | 'danger', goTo?: CueSpot) => void,
  onDiscarded: (paths: string[]) => void,
  onWritten: (written: RekordboxQueueWritten[]) => void,
  source: QueueSource = REKORDBOX_QUEUE,
): { state: RekordboxQueueState; applyNow: () => Promise<void>; discard: () => Promise<void> } {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  const [state, setState] = useState<RekordboxQueueState>(NOTHING)

  useEffect(() => {
    let live = true
    let pushed = false
    void source
      .read()
      .then((s) => {
        if (live && !pushed) setState(s)
      })
      .catch((e: unknown) => {
        window.api.logError(
          `${source.name}: first read failed (${e instanceof Error ? e.message : String(e)})`,
        )
      })
    const off = source.onChanged((s) => {
      pushed = true
      setState(s)
    })
    return () => {
      live = false
      off()
    }
  }, [source])

  const reread = useCallback(
    () =>
      Promise.all([
        ...DJ_PROGRAMS.map((p) =>
          queryClient.invalidateQueries({ queryKey: [SOURCE_PROGRAMS[p].membershipKey] }),
        ),
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['rekordbox-track-cues'] }),
        queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }),
      ]),
    [queryClient],
  )

  const announce = useCallback(
    (applied: RekordboxQueueApplied | null) => {
      if (!applied) return
      const message = appliedMessage(tr, applied, source.words)
      if (message?.goTo) notify(message.text, message.tone, message.goTo)
      else if (message) notify(message.text, message.tone)
      if ('written' in applied) onWritten(applied.written)
      void reread()
    },
    [tr, notify, reread, onWritten, source],
  )

  useEffect(() => source.onApplied(announce), [source, announce])

  useEffect(() => {
    void source.ready().catch(() => undefined)
  }, [source])

  const applyNow = useCallback(async () => {
    try {
      announce(await source.applyNow())
    } catch {
      notify(tr(source.words.refused('write-failed')), 'danger')
    }
  }, [announce, notify, tr, source])

  const discard = useCallback(async () => {
    const paths = state.items.flatMap((i) =>
      i.key.startsWith('track:') ? [i.key.slice('track:'.length)] : [],
    )
    try {
      await source.discard()
    } catch {
      notify(tr(source.words.refused('write-failed')), 'danger')
      return
    }
    onDiscarded(paths)
    void reread()
  }, [state, onDiscarded, reread, notify, tr, source])

  return { state, applyNow, discard }
}
