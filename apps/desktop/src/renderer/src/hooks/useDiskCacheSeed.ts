import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { PeekableAnalyses } from '../../../shared/audioIpcContract'

export function useDiskCacheSeed(
  family: keyof PeekableAnalyses,
  inputPath: string,
  wanted: boolean,
): void {
  const client = useQueryClient()
  useEffect(() => {
    if (!wanted || client.getQueryData([family, inputPath]) !== undefined) return
    void window.api.peekAnalysis(family, inputPath).then((hit) => {
      if (hit !== null && client.getQueryData([family, inputPath]) === undefined) {
        client.setQueryData([family, inputPath], hit)
      }
    })
  }, [client, family, inputPath, wanted])
}
