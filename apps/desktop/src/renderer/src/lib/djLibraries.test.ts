import { describe, expect, it } from 'vitest'
import { detectedDjLibraries } from './djLibraries'

// Which collection syncs are worth offering during onboarding. The step exists only for
// someone who actually runs one of these programs: a DJ who uses none should never see it.

describe('detectedDjLibraries', () => {
  it('offers rekordbox when a collection was found', () => {
    expect(
      detectedDjLibraries({ rekordbox: '/Users/dj/Library/Pioneer/rekordbox/master.db' }),
    ).toEqual([{ id: 'rekordbox', path: '/Users/dj/Library/Pioneer/rekordbox/master.db' }])
  })

  it('offers Traktor when a collection was found', () => {
    expect(detectedDjLibraries({ traktor: '/dj/collection.nml' })).toEqual([
      { id: 'traktor', path: '/dj/collection.nml' },
    ])
  })

  // Order is fixed rather than detection order, so the step reads the same on every
  // machine that finds both.
  it('lists both in a stable order', () => {
    expect(
      detectedDjLibraries({ traktor: '/dj/collection.nml', rekordbox: '/dj/master.db' }),
    ).toEqual([
      { id: 'rekordbox', path: '/dj/master.db' },
      { id: 'traktor', path: '/dj/collection.nml' },
    ])
  })

  // The whole point of the gate: nothing found means no step at all, rather than a step
  // offering two things the user cannot enable.
  it('offers nothing when no collection was found', () => {
    expect(detectedDjLibraries({})).toEqual([])
    expect(detectedDjLibraries({ rekordbox: '', traktor: '' })).toEqual([])
  })
})
