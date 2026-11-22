import { useQuery } from '@tanstack/react-query'
import { analysisOptions } from '../lib/analysisQueries'

export function copyDurationOptions(path: string) {
  return analysisOptions(
    'duration',
    path,
    (): Promise<number | null> => window.api.readDuration(path),
  )
}

export function useCopyDuration(path: string, enabled: boolean): number | null | undefined {
  const { data, isPending } = useQuery({ ...copyDurationOptions(path), enabled: enabled && !!path })
  return isPending ? undefined : (data ?? null)
}
