// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackCues } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { installApi } from '../test/api'
import { ANALYSIS_LOOK_MS, useAnalysisArrival } from './useAnalysisArrival'
import { surcoGridQuery, trackCuesQuery } from './useTrackCues'

const cues = (analysed: boolean): TrackCues => ({
  contentId: '7',
  analysed,
  grid: [],
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 1000,
  fingerprint: analysed ? 'b' : 'a',
  gridFingerprint: '',
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setUp(answers: boolean[]) {
  const trackCues = vi.fn(async () => cues(answers.shift() ?? true))
  let focus: (focused: boolean) => void = () => {}
  installApi({
    cues: { trackCues },
    onWindowFocus: (cb: (focused: boolean) => void) => {
      focus = cb
      return () => {}
    },
  })
  const client = createQueryClient()
  client.setQueryData(trackCuesQuery('7').queryKey, cues(false))
  client.setQueryData(surcoGridQuery('7').queryKey, { grid: [] })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { trackCues, client, wrapper, focus: (f: boolean) => focus(f) }
}

// rekordbox analyses while it stays open and writes into its library at once, yet the cue
// editor kept Surco's grid until Surco was restarted (26/11): the read was kept for good.
describe('useAnalysisArrival', () => {
  it('looks again every few seconds and takes rekordbox’s analysis once it is there', async () => {
    const { trackCues, client, wrapper } = setUp([false, true])
    renderHook(() => useAnalysisArrival('7', true), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ANALYSIS_LOOK_MS * 2)
    })
    expect(trackCues).toHaveBeenCalled()
    expect(client.getQueryData<TrackCues>(trackCuesQuery('7').queryKey)?.analysed).toBe(true)
    expect(client.getQueryState(surcoGridQuery('7').queryKey)?.isInvalidated).toBe(true)
  })

  it('looks again on coming back to Surco from rekordbox', async () => {
    const { trackCues, client, wrapper, focus } = setUp([false, true])
    renderHook(() => useAnalysisArrival('7', true), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    trackCues.mockClear()
    await act(async () => {
      focus(true)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(trackCues).toHaveBeenCalledTimes(1)
    expect(client.getQueryData<TrackCues>(trackCuesQuery('7').queryKey)?.analysed).toBe(true)
  })

  // The cue draft is keyed on the read: taking the analysis under unsaved cues would drop them.
  it('does not look while the track is analysed or its cues are unsaved', async () => {
    const { trackCues, wrapper, focus } = setUp([true])
    renderHook(() => useAnalysisArrival('7', false), { wrapper })
    await act(async () => {
      focus(true)
      await vi.advanceTimersByTimeAsync(ANALYSIS_LOOK_MS * 3)
    })
    expect(trackCues).not.toHaveBeenCalled()
  })
})
