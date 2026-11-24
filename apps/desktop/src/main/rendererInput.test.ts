import { describe, expect, it } from 'vitest'
import { statBumpOf, windowSnapshotOf } from './rendererInput'

describe('statBumpOf', () => {
  it('bumps a known tally by one unless told how much', () => {
    expect(statBumpOf('imported', undefined)).toEqual({ key: 'imported', by: 1 })
    expect(statBumpOf('listened', 4)).toEqual({ key: 'listened', by: 4 })
    expect(statBumpOf('analyzed', '4')).toEqual({ key: 'analyzed', by: 1 })
  })

  // This channel takes renderer input: an arbitrary string must never land in the
  // settings file as a new property.
  it('refuses a key that is not a tally', () => {
    expect(statBumpOf('beatportPassword', 1)).toBeNull()
    expect(statBumpOf(7, 1)).toBeNull()
    expect(statBumpOf(undefined, undefined)).toBeNull()
  })
})

describe('windowSnapshotOf', () => {
  const sample = { heapUsedMb: 120, heapLimitMb: 4096, listTracks: 900 }

  it('keeps a snapshot with its source when the renderer names one', () => {
    expect(windowSnapshotOf({ ...sample, source: 'rekordbox', sourceTracks: 30000 })).toEqual({
      ...sample,
      source: 'rekordbox',
      sourceTracks: 30000,
    })
  })

  it('reads a missing or malformed source as none', () => {
    expect(windowSnapshotOf({ ...sample, source: 3, sourceTracks: 'x' })).toEqual({
      ...sample,
      source: null,
      sourceTracks: null,
    })
  })

  // The crash watch reads these numbers to say why the window died, so a snapshot
  // missing one of them is dropped rather than logged as a misleading zero.
  it('drops a snapshot without the numbers the crash watch reads', () => {
    expect(windowSnapshotOf({ heapUsedMb: 120, heapLimitMb: 4096 })).toBeNull()
    expect(windowSnapshotOf({ ...sample, listTracks: '900' })).toBeNull()
    expect(windowSnapshotOf(null)).toBeNull()
    expect(windowSnapshotOf('snapshot')).toBeNull()
  })
})
