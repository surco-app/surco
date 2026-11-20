import { describe, expect, it } from 'vitest'
import type { BpmResult, KeyResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { fillMeasuredPatches } from './fillMeasured'

function track(id: string, meta: Record<string, string> = {}): TrackItem {
  return { id, inputPath: `/in/${id}.wav`, meta } as unknown as TrackItem
}

const bpms: Record<string, BpmResult | null> = {
  '/in/a.wav': { bpm: 127.6, confidence: 1 },
  '/in/b.wav': null,
}
const keys: Record<string, KeyResult | null> = {
  '/in/a.wav': { camelot: '8A', name: 'Am', confidence: 1 },
}
const measured = { bpm: (p: string) => bpms[p], key: (p: string) => keys[p] }

describe('fillMeasuredPatches', () => {
  it('writes the rounded measured BPM into an empty field', () => {
    expect(fillMeasuredPatches([track('a')], { ...measured, key: () => null }, 'camelot')).toEqual([
      { id: 'a', meta: { bpm: '128' } },
    ])
  })

  it('leaves a BPM the user already wrote untouched', () => {
    const patches = fillMeasuredPatches([track('a', { bpm: '90' })], measured, 'camelot')
    expect(patches).toEqual([{ id: 'a', meta: { key: '8A' } }])
  })

  it('treats a blank field as empty', () => {
    const patches = fillMeasuredPatches([track('a', { bpm: '  ' })], measured, 'camelot')
    expect(patches[0].meta.bpm).toBe('128')
  })

  it('writes nothing when the measurement is null or missing', () => {
    expect(fillMeasuredPatches([track('b'), track('c')], measured, 'camelot')).toEqual([])
  })

  it('writes the key in the notation the setting asks for', () => {
    const only = { bpm: () => null, key: measured.key }
    expect(fillMeasuredPatches([track('a')], only, 'camelot')[0].meta.key).toBe('8A')
    expect(fillMeasuredPatches([track('a')], only, 'musical')[0].meta.key).toBe('Am')
  })

  it('gives a track with both fields empty a single patch carrying both', () => {
    expect(fillMeasuredPatches([track('a')], measured, 'musical')).toEqual([
      { id: 'a', meta: { bpm: '128', key: 'Am' } },
    ])
  })

  it('returns no patches when there is nothing to fill', () => {
    const full = track('a', { bpm: '120', key: '1A' })
    expect(fillMeasuredPatches([full], measured, 'camelot')).toEqual([])
  })
})
