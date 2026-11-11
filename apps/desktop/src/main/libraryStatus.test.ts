import { describe, expect, it } from 'vitest'
import { libraryStatus } from './libraryStatus'

const base = {
  syncRekordbox: true,
  rekordboxDbPath: '/lib/rb/master.db',
  syncEngineDj: true,
  engineLibraryDir: '/lib/engine',
  syncTraktor: true,
  traktorNmlPath: '/lib/traktor/collection.nml',
  syncSerato: false,
  syncVirtualdj: false,
  virtualdjLibraryDir: '/lib/vdj',
}

describe('libraryStatus', () => {
  it('finds each library whose path exists', () => {
    expect(libraryStatus(base, () => true, true)).toEqual({
      rekordbox: { enabled: true, found: true },
      engine: { enabled: true, found: true },
      traktor: { enabled: true, found: true },
      serato: { enabled: false, found: true },
      virtualdj: { enabled: false, found: true },
    })
  })

  // The user's real case: a configured rekordbox path to a test copy that was deleted
  // still reads as "configured", so only the disk can tell the sync has nowhere to go.
  it('reports a configured path that is not on disk as not found', () => {
    const status = libraryStatus(base, (p) => p !== '/lib/rb/master.db', true)
    expect(status.rekordbox).toEqual({ enabled: true, found: false })
    expect(status.engine.found).toBe(true)
  })

  it('looks for Engine DJ in its m.db, not just its folder', () => {
    const status = libraryStatus(base, (p) => p === '/lib/engine', true)
    expect(status.engine.found).toBe(false)
  })

  it('keeps a library that is switched off apart from one that is missing', () => {
    const status = libraryStatus({ ...base, syncTraktor: false }, () => false, false)
    expect(status.traktor).toEqual({ enabled: false, found: false })
  })

  it('treats a Traktor toggle with no path as not found', () => {
    expect(libraryStatus({ ...base, traktorNmlPath: '' }, () => true, true).traktor.found).toBe(
      false,
    )
  })

  it('reports Serato enabled and found apart', () => {
    expect(libraryStatus({ ...base, syncSerato: true }, () => false, false).serato).toEqual({
      enabled: true,
      found: false,
    })
  })

  it('finds VirtualDJ by its database in the folder Settings names, not just the folder', () => {
    const status = libraryStatus(base, (p) => p === '/lib/vdj/database.xml', false)
    expect(status.virtualdj).toEqual({ enabled: false, found: true })
    expect(libraryStatus(base, (p) => p === '/lib/vdj', false).virtualdj.found).toBe(false)
  })

  it('reports VirtualDJ enabled and found apart', () => {
    expect(libraryStatus({ ...base, syncVirtualdj: true }, () => false, false).virtualdj).toEqual({
      enabled: true,
      found: false,
    })
  })
})
