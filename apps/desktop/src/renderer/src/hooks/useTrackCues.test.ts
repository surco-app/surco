import { describe, expect, it } from 'vitest'
import { HEAVY_PROBE_GC_MS } from '../lib/analysisQueries'
import { cueDropInputQuery, cueWaveDetailQuery } from './useTrackCues'

describe('the wave the cue editor reads', () => {
  it('is let go a few minutes after the editor leaves the track, so a long session does not hold one for every track visited', () => {
    expect(cueWaveDetailQuery('103').gcTime).toBe(HEAVY_PROBE_GC_MS)
    expect(cueDropInputQuery('engine:4').gcTime).toBe(HEAVY_PROBE_GC_MS)
  })
})
