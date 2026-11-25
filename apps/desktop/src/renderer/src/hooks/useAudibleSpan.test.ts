import { describe, expect, it } from 'vitest'
import { gatedWaveOptions } from './useAudibleSpan'

describe('gatedWaveOptions', () => {
  // React Query keeps a select's result only while the select is the same function: a new one
  // on every render ran the gate's sort over every peak of the waveform each time.
  it('selects through one function whatever the path or the render', () => {
    expect(gatedWaveOptions('/a.wav').select).toBe(gatedWaveOptions('/b.wav').select)
  })
})
