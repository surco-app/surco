import { describe, expect, it } from 'vitest'
import type { CueSummary } from '../../../shared/types'
import type { TrackItem } from '../types'
import { cueSwatchesOf } from './cueSwatches'

const track = (id: string, inputPath: string) => ({ id, inputPath }) as TrackItem
const SUMMARY: CueSummary = { analysed: true, hot: [{ ms: 1000, color: 1 }] }
const CONTENT_OF = new Map([
  ['a', '1'],
  ['b', '2'],
])

describe('cueSwatchesOf', () => {
  it('gives each row its summary and whether its cues wait in the queue', () => {
    const swatches = cueSwatchesOf(
      [track('a', '/m/a.wav'), track('b', '/m/b.wav'), track('c', '/m/c.wav')],
      CONTENT_OF,
      { '1': SUMMARY, '2': SUMMARY },
      new Set(['/m/b.wav']),
      new Map(),
    )
    expect(swatches.get('a')).toEqual({ summary: SUMMARY, pending: false })
    expect(swatches.get('b')).toEqual({ summary: SUMMARY, pending: true })
    expect(swatches.has('c')).toBe(false)
  })

  it('keeps the entries of rows that did not change, so memoized rows do not re-render on an edit', () => {
    const tracks = [track('a', '/m/a.wav'), track('b', '/m/b.wav')]
    const summaries = { '1': SUMMARY, '2': SUMMARY }
    const first = cueSwatchesOf(tracks, CONTENT_OF, summaries, new Set(), new Map())
    const next = cueSwatchesOf(
      [{ ...tracks[0] }, tracks[1]],
      CONTENT_OF,
      summaries,
      new Set(['/m/b.wav']),
      first,
    )
    expect(next.get('a')).toBe(first.get('a'))
    expect(next.get('b')).not.toBe(first.get('b'))
  })
})
