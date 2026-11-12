import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type CueProgram, DJ_PROGRAMS } from '../../../shared/djProgram'
import type {
  QueuedCreate,
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
  VIRTUALDJ_QUEUE_WORDS,
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

function queueSource(p: CueProgram, name: string, words: QueueWords): QueueSource {
  return {
    name,
    read: () => window.api.dj.cueQueue(p),
    onChanged: (cb) => window.api.dj.onCueQueueChanged(p, cb),
    onApplied: (cb) => window.api.dj.onCueQueueApplied(p, cb),
    ready: () => window.api.dj.cueQueueReady(p),
    applyNow: () => window.api.dj.applyCueQueue(p),
    discard: () => window.api.dj.discardCueQueue(p),
    words,
  }
}

export const REKORDBOX_QUEUE = queueSource('rekordbox', 'rekordbox queue', REKORDBOX_QUEUE_WORDS)
export const ENGINE_CUE_QUEUE = queueSource('engine', 'Engine DJ cue queue', ENGINE_QUEUE_WORDS)
export const TRAKTOR_CUE_QUEUE = queueSource('traktor', 'Traktor cue queue', TRAKTOR_QUEUE_WORDS)
export const SERATO_CUE_QUEUE = queueSource('serato', 'Serato cue queue', SERATO_QUEUE_WORDS)
export const VIRTUALDJ_CUE_QUEUE = queueSource(
  'virtualdj',
  'VirtualDJ cue queue',
  VIRTUALDJ_QUEUE_WORDS,
)

export const PROGRAM_QUEUES = {
  rekordbox: { source: REKORDBOX_QUEUE, testid: 'rekordbox-queue' },
  engine: { source: ENGINE_CUE_QUEUE, testid: 'engine-queue' },
  traktor: { source: TRAKTOR_CUE_QUEUE, testid: 'traktor-queue' },
  serato: { source: SERATO_CUE_QUEUE, testid: 'serato-queue' },
  virtualdj: { source: VIRTUALDJ_CUE_QUEUE, testid: 'virtualdj-queue' },
} satisfies Record<CueProgram, { source: QueueSource; testid: string } | null>

export function useRekordboxQueue(
  notify: (text: string, tone: 'neutral' | 'danger', goTo?: CueSpot) => void,
  onDiscarded: (paths: string[]) => void,
  onWritten: (written: RekordboxQueueWritten[]) => void,
  source: QueueSource = REKORDBOX_QUEUE,
  onCreated?: (created: QueuedCreate[]) => void,
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
      if ('created' in applied && applied.created) onCreated?.(applied.created)
      void reread()
    },
    [tr, notify, reread, onWritten, source, onCreated],
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
