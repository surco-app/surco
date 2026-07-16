// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeatgridResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { useBeatgrid } from './useBeatgrid'

const sample: BeatgridResult = {
  bpm: 124.02,
  confidence: 0.8,
  anchorSec: 0.25,
  phaseAmbiguity: 0.1,
  phaseMargin: 5,
}

function setApi(beatgrid: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { beatgrid }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useBeatgrid', () => {
  // Each detection decodes minutes of audio, so the suggestion must analyse the
  // exact track whose grid section is open and run that decode once.
  it('detects the input path and returns the grid', async () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useBeatgrid('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    // The grid section mounts this only for the selected track, the one the user is waiting
    // on, so it decodes at 'high' to jump ahead of a background sweep's 'low' floods. It is
    // never the fresh re-detect (that path passes true through GridSection), so fresh stays
    // undefined here.
    expect(detect).toHaveBeenCalledWith('/music/a.wav', undefined, 'high')
  })

  // The grid section is folded by default (and absent in multi-select); with
  // nothing to draw, the expensive decode must not run.
  it('does not detect while disabled', () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useBeatgrid('/music/a.wav', false), { wrapper: wrapper() })
    expect(detect).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  // Beatless material legitimately measures null; the section shows no detected
  // grid rather than drawing confident-looking lines through ambience.
  it('returns null when no grid was found', async () => {
    setApi(vi.fn().mockResolvedValue(null))
    const { result } = renderHook(() => useBeatgrid('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toBeNull())
  })
})
