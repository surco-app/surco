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

// The registry closes a race on the very volumes Surco runs on, and those are
// case-insensitive: on macOS and Windows "Artist - Title.aiff" and "artist - title.aiff"
// are ONE file. inplace.ts already spells the rule out — isSameFile compares device+inode
// "because a case-only difference (Song.WAV vs song.wav) is one file on the
// case-insensitive macOS/Windows volumes Surco runs on" — but a reservation cannot reuse
// it: the file a claim protects does not exist on disk yet, which is the whole point of
// claiming it. Matching the raw string instead let two concurrent jobs whose tags differ
// only in case (a Discogs match filling "Aphex Twin" beside a sibling tagged "aphex twin")
// both claim what the OS treats as one destination: two encodes, two renames, "2
// converted", one file. The very loss this registry exists to prevent, by another door.
describe('createOutputReservations on a case-insensitive host', () => {
  // Asked for explicitly rather than left to the host: on Linux the default is the other
  // way, and these three would quietly stop testing anything the day CI moved there.
  const onFoldingHost = () => createOutputReservations(true)

  it('treats a case-only difference as the same claim', () => {
    const reservations = onFoldingHost()
    reservations.reserve('/out/Artist - Title.aiff')
    expect(reservations.isReserved('/out/artist - title.aiff')).toBe(true)
  })

  it('releases the claim whatever case the caller spells it with', () => {
    const reservations = onFoldingHost()
    reservations.reserve('/out/Artist - Title.aiff')
    reservations.release('/out/ARTIST - TITLE.AIFF')
    expect(reservations.isReserved('/out/Artist - Title.aiff')).toBe(false)
  })

  // Folding case must not blur two genuinely different names into one claim, or a batch
  // would start prompting for conflicts that aren't there.
  it('still tells different names apart', () => {
    const reservations = onFoldingHost()
    reservations.reserve('/out/a.aiff')
    expect(reservations.isReserved('/out/b.aiff')).toBe(false)
  })
})

// Linux keeps the two names apart, and so must the registry: folding there would make a
// batch prompt for a conflict between two files that can happily coexist.
describe('createOutputReservations on a case-sensitive host', () => {
  it('keeps a case-only difference as two separate claims', () => {
    const reservations = createOutputReservations(false)
    reservations.reserve('/out/Artist - Title.aiff')
    expect(reservations.isReserved('/out/artist - title.aiff')).toBe(false)
  })
})
