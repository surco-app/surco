import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Settings } from '../../../shared/types'
import { withRekordboxField } from '../lib/fields'
import {
  type Membership,
  type PlaylistOption,
  playlistOptions,
  rekordboxPathOf,
} from '../lib/rekordboxPlaylists'
import type { TrackItem } from '../types'

export function useRekordboxAvailable(): boolean {
  const { data = false } = useQuery({
    queryKey: ['source-available', 'rekordbox'],
    queryFn: () => window.api.rekordboxAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data
}

export function useRekordboxPlaylistOptions(enabled: boolean): PlaylistOption[] | undefined {
  const { data } = useQuery({
    queryKey: ['source-tree', 'rekordbox'],
    queryFn: () => window.api.loadRekordboxTree(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return useMemo(() => (data ? playlistOptions(data) : undefined), [data])
}

export function useRekordboxMembership(
  paths: string[],
  enabled: boolean,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
): Membership | undefined {
  const key = [...new Set(paths)].sort()
  const { data } = useQuery({
    queryKey: ['rekordbox-membership', key],
    queryFn: () => window.api.rekordboxMembership(key),
    enabled: enabled && key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  })
  return data
}

const LIST_MEMBERSHIP_DEBOUNCE_MS = 1000

export function useRekordboxListMembership(
  tracks: readonly TrackItem[],
  enabled: boolean,
): Membership | undefined {
  const paths = useMemo(() => (enabled ? tracks.map(rekordboxPathOf) : []), [tracks, enabled])
  const [settled, setSettled] = useState(paths)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(paths), LIST_MEMBERSHIP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [paths])
  return useRekordboxMembership(settled, enabled, { keepPrevious: true })
}

export function useOfferRekordboxField(
  settings: Settings | null,
  available: boolean,
  save: (patch: Partial<Settings>) => void,
): void {
  const tried = useRef(false)
  useEffect(() => {
    if (!settings || tried.current) return
    const next = withRekordboxField(
      settings.visibleFields,
      settings.rekordboxPlaylistsFieldOffered,
      available,
    )
    if (!next) return
    tried.current = true
    save({ visibleFields: next, rekordboxPlaylistsFieldOffered: true })
  }, [settings, available, save])
}
