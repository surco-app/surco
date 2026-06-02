import { describe, expect, it } from 'vitest'
import { tmpName } from './tmp'

describe('tmpName', () => {
  // The bug this guards against: cover/spectrogram temp files were named with
  // Date.now(), so two extractions in the same millisecond (addPaths reads
  // several files in parallel) collided on one path — one overwrote or unlinked
  // the other's file mid-read. A unique name per call removes the race.
  it('never repeats across calls', () => {
    const names = new Set(Array.from({ length: 1000 }, () => tmpName('cover', 'jpg')))
    expect(names.size).toBe(1000)
  })

  it('keeps the prefix and extension so temp files stay recognizable', () => {
    expect(tmpName('cover', 'jpg')).toMatch(/^surco-cover-[0-9a-f-]+\.jpg$/)
  })
})
