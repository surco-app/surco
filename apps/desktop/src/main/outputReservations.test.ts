import { describe, expect, it } from 'vitest'
import { createOutputReservations } from './outputReservations'

describe('createOutputReservations', () => {
  // A batch runs several jobs concurrently (mapWithConcurrency). Two tracks whose
  // metadata resolves to the same output name both see existsSync() === false at
  // the moment they check, so without this registry both proceed and the second
  // rename silently overwrites the first — "2 converted" and one file on disk.
  it('reports a path as taken once reserved, freeing it on release', () => {
    const reservations = createOutputReservations()
    expect(reservations.isReserved('/out/Artist - Title.aiff')).toBe(false)
    reservations.reserve('/out/Artist - Title.aiff')
    expect(reservations.isReserved('/out/Artist - Title.aiff')).toBe(true)
    reservations.release('/out/Artist - Title.aiff')
    expect(reservations.isReserved('/out/Artist - Title.aiff')).toBe(false)
  })

  it('tracks reservations per path independently', () => {
    const reservations = createOutputReservations()
    reservations.reserve('/out/a.aiff')
    expect(reservations.isReserved('/out/b.aiff')).toBe(false)
    reservations.release('/out/a.aiff')
    expect(reservations.isReserved('/out/a.aiff')).toBe(false)
  })

  // A job that reserves a path twice (retry, or two stages of the same job) must not
  // have the second release evict the first job's still-active claim.
  it('is idempotent to reserve and survives one release while held twice', () => {
    const reservations = createOutputReservations()
    reservations.reserve('/out/a.aiff')
    reservations.reserve('/out/a.aiff')
    reservations.release('/out/a.aiff')
    expect(reservations.isReserved('/out/a.aiff')).toBe(true)
    reservations.release('/out/a.aiff')
    expect(reservations.isReserved('/out/a.aiff')).toBe(false)
  })
})
