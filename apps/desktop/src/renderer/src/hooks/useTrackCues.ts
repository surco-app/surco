import { keepPreviousData, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { CueProfileRead } from '../../../shared/cueProfile'
import type { GridAudit } from '../../../shared/gridAudit'
import type { GridFit } from '../../../shared/gridEdit'
import type { FineWave, QueuedCues, SurcoGrid, TrackCues } from '../../../shared/types'
import { HEAVY_PROBE_GC_MS } from '../lib/analysisQueries'
import { beatsKey } from '../lib/gridAuditCheck'

export const trackCuesQuery = (contentId: string) => ({
  queryKey: ['rekordbox-track-cues', contentId],
  queryFn: () => window.api.cues.trackCues(contentId),
  staleTime: Number.POSITIVE_INFINITY,
})

export const queuedCuesQuery = (contentId: string) => ({
  queryKey: ['rekordbox-queued-cues', contentId],
  queryFn: () =>
    window.api.cues.queued(contentId).catch((e: unknown) => {
      window.api.logError(
        `rekordbox cues: queued save unreadable (${e instanceof Error ? e.message : String(e)})`,
      )
      return null
    }),
  staleTime: Number.POSITIVE_INFINITY,
})

export const cueWaveDetailQuery = (contentId: string) => ({
  queryKey: ['rekordbox-cue-wave-detail', contentId],
  queryFn: () => window.api.cues.waveDetail(contentId),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: HEAVY_PROBE_GC_MS,
})

export const surcoGridQuery = (contentId: string) => ({
  queryKey: ['rekordbox-surco-grid', contentId],
  queryFn: () => window.api.cues.surcoGrid(contentId),
  staleTime: Number.POSITIVE_INFINITY,
})

export const cueDropInputQuery = (contentId: string) => ({
  queryKey: ['rekordbox-cue-drop-input', contentId],
  queryFn: () => window.api.cues.dropInput(contentId),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: HEAVY_PROBE_GC_MS,
})

export const gridFitQuery = (contentId: string) => ({
  queryKey: ['rekordbox-grid-fit', contentId],
  queryFn: () => window.api.cues.gridFit(contentId),
  staleTime: Number.POSITIVE_INFINITY,
})

// What the cue editor reads from the file a track points at and from the program's analysis
// of it. A repoint or a replacement keeps the content id while changing both, so these are
// read again: cues are placed against the file the DJ will play, not the one it replaced.
const TRACK_FILE_QUERY_KEYS = [
  'rekordbox-track-cues',
  'rekordbox-cue-wave-detail',
  'rekordbox-cue-wave-fine',
  'rekordbox-audition-lead',
  'rekordbox-surco-grid',
  'rekordbox-grid-fit',
  'grid-audit',
  'rekordbox-cue-drop-input',
  'cue-preview-drop-input',
]

export function rereadTrackFileQueries(client: QueryClient): Promise<void>[] {
  return TRACK_FILE_QUERY_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] }))
}

export const cueProfileQuery = {
  queryKey: ['cue-profile'],
  queryFn: () => window.api.cueProfile(),
  staleTime: Number.POSITIVE_INFINITY,
}

export function useCueProfile(): CueProfileRead | undefined {
  const client = useQueryClient()
  useEffect(
    () =>
      window.api.onCueProfileChanged(() => {
        void client.invalidateQueries({ queryKey: cueProfileQuery.queryKey })
      }),
    [client],
  )
  return useQuery(cueProfileQuery).data
}

export function useTrackCues(contentId: string | undefined): {
  data: TrackCues | null | undefined
  isError: boolean
} {
  const { data, isError } = useQuery({
    ...trackCuesQuery(contentId as string),
    enabled: contentId !== undefined,
  })
  return { data, isError }
}

export function useQueuedCues(contentId: string): { data: QueuedCues | null | undefined } {
  const { data } = useQuery(queuedCuesQuery(contentId))
  return { data }
}

export function useSurcoGrid(
  contentId: string,
  enabled: boolean,
): { data: SurcoGrid | null | undefined } {
  const { data, isError } = useQuery({ ...surcoGridQuery(contentId), enabled })
  return { data: isError ? null : data }
}

export function useAuditionLead(contentId: string): number {
  const { data } = useQuery({
    queryKey: ['rekordbox-audition-lead', contentId],
    queryFn: () => window.api.cues.auditionLead(contentId),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data ?? 0
}

export function useCueWaveDetail(
  contentId: string,
  enabled: boolean,
): { data: Uint16Array | null | undefined } {
  const { data } = useQuery({ ...cueWaveDetailQuery(contentId), enabled })
  return { data }
}

export function useCueWaveFine(contentId: string, enabled: boolean): FineWave | null | undefined {
  const { data, isPending } = useQuery({
    queryKey: ['rekordbox-cue-wave-fine', contentId],
    queryFn: () => window.api.cues.waveFine(contentId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (!enabled) return null
  return isPending ? undefined : (data ?? null)
}

export const gridAuditQuery = (contentId: string, beats: number[]) => ({
  queryKey: ['grid-audit', contentId, beatsKey(beats)],
  queryFn: () => window.api.cues.gridAudit(contentId, beats, 'high'),
  staleTime: Number.POSITIVE_INFINITY,
})

export function useGridAudit(
  contentId: string,
  beats: number[],
  enabled: boolean,
): GridAudit | null | undefined {
  const { data } = useQuery({
    ...gridAuditQuery(contentId, beats),
    enabled,
    placeholderData: keepPreviousData,
  })
  return enabled ? data : null
}

export function useGridFit(contentId: string, enabled: boolean): GridFit | null {
  const { data } = useQuery({ ...gridFitQuery(contentId), enabled })
  return enabled ? (data ?? null) : null
}
