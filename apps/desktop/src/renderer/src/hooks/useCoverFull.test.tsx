// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { useCoverFull } from './useCoverFull'

function setApi(readCoverFull: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { readCoverFull }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useCoverFull', () => {
  // The lightbox shows the file's own embedded art at full resolution, which means
  // re-extracting the original picture from the file — keyed by that source path so
  // reopening the lightbox never re-extracts it.
  it('extracts the original artwork for the source path', async () => {
    const read = vi.fn().mockResolvedValue('data:image/jpeg;base64,FULL')
    setApi(read)
    const { result } = renderHook(() => useCoverFull('/music/a.flac'), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.data).toBe('data:image/jpeg;base64,FULL'))
    expect(read).toHaveBeenCalledWith('/music/a.flac')
  })

  // When the displayed cover is not the file's own art (a release image, already
  // full-size) there is nothing to re-extract, so the query must stay idle rather
  // than spawn a pointless extraction.
  it('does not extract when there is no source to pull from', () => {
    const read = vi.fn()
    setApi(read)
    const { result } = renderHook(() => useCoverFull(undefined), { wrapper: wrapper() })

    expect(read).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })
})
