import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'

// Roughly 1 bucket per viewport pixel across the 3-viewport window below —
// enough that the deep zoom draws real detail, small enough to stay a
// sub-second decode and a light IPC payload.
const WINDOW_BUCKETS = 3600

// The slice of the track the deep zoom should have decoded for the current view:
// three viewports wide (one each side of the visible one, so small scrolls stay
// inside it) and quantized to a viewport-sized grid, so scrolling re-uses cached
// windows instead of re-decoding on every pixel.
export function windowFor(
  durationSec: number,
  viewFromRatio: number,
  zoom: number,
): { startSec: number; durSec: number } {
  const visibleSec = durationSec / zoom
  const startSec = Math.max(0, (Math.floor(viewFromRatio * zoom) - 1) * visibleSec)
  const durSec = Math.min(durationSec - startSec, visibleSec * 3)
  return { startSec: Number(startSec.toFixed(3)), durSec: Number(durSec.toFixed(3)) }
}

export interface WaveformWindow {
  peaks: number[]
  // The RMS body for this window, same grid as peaks — the two-layer draw stays
  // consistent between the overview strip and the deep-zoom re-decode over it.
  rms: number[]
  // The slice this data actually covers, stamped by the fetch: keepPreviousData
  // hands back the PREVIOUS window while the next loads, and the drawer must map
  // those peaks by the coords they belong to, never by the ones just requested.
  startSec: number
  durSec: number
}

// The on-demand re-decode behind the strips' deep zoom: past the global envelope's
// resolution the visible window is decoded at full waveform fidelity, DAW-style.
// keepPreviousData holds the last window up while the next loads, so scrolling
// refines instead of flashing blank.
export function useWaveformWindow(
  inputPath: string | undefined,
  startSec: number,
  durSec: number,
  enabled: boolean,
): UseQueryResult<WaveformWindow | null> {
  return useQuery({
    queryKey: ['waveform-window', inputPath, startSec, durSec],
    queryFn: async () => {
      const r = await window.api.waveformWindow(inputPath as string, startSec, durSec, WINDOW_BUCKETS)
      return r ? { peaks: r.peaks, rms: r.rms, startSec, durSec } : null
    },
    enabled: enabled && !!inputPath && durSec > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 120_000,
    placeholderData: keepPreviousData,
  })
}
