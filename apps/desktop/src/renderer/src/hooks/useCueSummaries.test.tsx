// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type React from 'react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { CueSummary } from '../../../shared/types'
import { installApi } from '../test/api'
import { useCueSummaries } from './useCueSummaries'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

const SUMMARY: CueSummary = { analysed: true, hot: [] }

describe('useCueSummaries', () => {
  it('asks once for a crate that streams in batch by batch, and keeps the swatches meanwhile', async () => {
    vi.useFakeTimers()
    try {
      const rekordboxCueSummary = vi.fn<Api['rekordboxCueSummary']>(async (ids) =>
        Object.fromEntries(ids.map((id) => [id, SUMMARY])),
      )
      installApi({ rekordboxCueSummary })
      const { result, rerender } = renderHook(({ ids }) => useCueSummaries(ids, true), {
        wrapper,
        initialProps: { ids: ['1'] },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(rekordboxCueSummary).toHaveBeenCalledTimes(1)
      expect(Object.keys(result.current)).toEqual(['1'])
      rekordboxCueSummary.mockClear()
      for (const ids of [
        ['1', '2'],
        ['1', '2', '3'],
        ['1', '2', '3', '4'],
      ]) {
        rerender({ ids })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300)
        })
        expect(Object.keys(result.current)).toEqual(['1'])
      }
      expect(rekordboxCueSummary).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(rekordboxCueSummary).toHaveBeenCalledTimes(1)
      expect(rekordboxCueSummary).toHaveBeenCalledWith(['1', '2', '3', '4'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the previous swatches while the next key loads', async () => {
    vi.useFakeTimers()
    try {
      let release: (v: Record<string, CueSummary>) => void = () => {}
      const rekordboxCueSummary = vi
        .fn<Api['rekordboxCueSummary']>()
        .mockResolvedValueOnce({ '1': SUMMARY })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            }),
        )
      installApi({ rekordboxCueSummary })
      const { result, rerender } = renderHook(({ ids }) => useCueSummaries(ids, true), {
        wrapper,
        initialProps: { ids: ['1'] },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      rerender({ ids: ['1', '2'] })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(Object.keys(result.current)).toEqual(['1'])
      await act(async () => {
        release({ '1': SUMMARY, '2': SUMMARY })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(Object.keys(result.current)).toEqual(['1', '2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does no work while rekordbox is unavailable', async () => {
    const rekordboxCueSummary = vi.fn<Api['rekordboxCueSummary']>(async () => ({}))
    installApi({ rekordboxCueSummary })
    renderHook(() => useCueSummaries(['1'], false), { wrapper })
    expect(rekordboxCueSummary).not.toHaveBeenCalled()
  })
})
