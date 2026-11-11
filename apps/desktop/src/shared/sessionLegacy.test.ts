import { describe, expect, it } from 'vitest'
import { emptyMetadata } from './metadata'
import { fromLegacy, type LegacyOrigin, withLegacy } from './sessionLegacy'
import type { SessionEdit } from './types'

type Saved = SessionEdit & LegacyOrigin

const meta = { ...emptyMetadata(), title: 'Saved' }

type OldFields = Record<string, unknown>

const OLD_FLAG_ORDER = ['rekordbox', 'engine', 'traktor', 'serato'] as const
const OLD_LIBRARY_ORDER = ['rekordbox', 'traktor', 'engine', 'serato'] as const
const OLD_FLAG = {
  rekordbox: 'fromRekordbox',
  traktor: 'fromTraktor',
  engine: 'fromEngine',
  serato: 'fromSerato',
} as const

function oldCopyFlags(from: OldFields, to: OldFields): void {
  for (const program of OLD_FLAG_ORDER) {
    const flag = OLD_FLAG[program]
    if (from[flag]) to[flag] = true
  }
}

function oldCopyPlaylists(from: OldFields, to: OldFields): void {
  for (const program of OLD_LIBRARY_ORDER) {
    const playlists = `${program}Playlists`
    const playlistsBase = `${program}PlaylistsBase`
    if (from[playlists]) to[playlists] = from[playlists]
    if (from[playlistsBase]) to[playlistsBase] = from[playlistsBase]
  }
}

function olderVersionReads(edit: Saved): OldFields {
  const read: OldFields = {}
  oldCopyFlags(edit as unknown as OldFields, read)
  oldCopyPlaylists(edit as unknown as OldFields, read)
  return read
}

const TODAY: Record<string, Saved> = {
  '/m/rekordbox.wav': {
    meta,
    fromRekordbox: true,
    rekordboxPlaylists: [{ id: '3000', name: 'Makina' }],
  },
  '/m/traktor.wav': { meta, fromTraktor: true, traktorPlaylistsBase: [] },
  '/m/engine.wav': {
    meta,
    fromEngine: true,
    enginePlaylists: [{ id: '7', name: 'House' }],
    enginePlaylistsBase: ['2'],
  },
  '/m/serato.wav': {
    meta,
    fromSerato: true,
    seratoPlaylists: [{ id: 'A', name: 'A' }],
    seratoPlaylistsBase: ['B'],
  },
}

describe('fromLegacy', () => {
  it('reads a session saved by the current version', () => {
    const read = Object.fromEntries(
      Object.entries(TODAY).map(([path, edit]) => [path, fromLegacy(edit)]),
    )
    expect(read).toEqual({
      '/m/rekordbox.wav': {
        meta,
        programs: ['rekordbox'],
        playlists: { rekordbox: { targets: [{ id: '3000', name: 'Makina' }] } },
      },
      '/m/traktor.wav': { meta, programs: ['traktor'], playlists: { traktor: { base: [] } } },
      '/m/engine.wav': {
        meta,
        programs: ['engine'],
        playlists: { engine: { targets: [{ id: '7', name: 'House' }], base: ['2'] } },
      },
      '/m/serato.wav': {
        meta,
        programs: ['serato'],
        playlists: { serato: { targets: [{ id: 'A', name: 'A' }], base: ['B'] } },
      },
    })
  })

  it('reads every origin of a file that sits in several libraries', () => {
    const read = fromLegacy({
      meta,
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
    })
    expect([...(read.programs ?? [])].sort()).toEqual(['engine', 'rekordbox', 'serato', 'traktor'])
  })

  it('does not turn an origin saved as false into a program, so a hand-edited session stays a loose file', () => {
    expect(fromLegacy({ meta, fromSerato: false, fromRekordbox: false })).toEqual({ meta })
  })

  it('leaves none of the old keys behind, so the reopened row holds one copy of each fact', () => {
    const read = fromLegacy(TODAY['/m/engine.wav'])
    expect(Object.keys(read).sort()).toEqual(['meta', 'playlists', 'programs'])
  })

  it('keeps the rest of the saved edit as it was', () => {
    const read = fromLegacy({ meta, outputName: 'x', matched: true, fromTraktor: true })
    expect(read).toEqual({ meta, outputName: 'x', matched: true, programs: ['traktor'] })
  })

  it('prefers the new fields when a session carries both', () => {
    const read = fromLegacy({
      meta,
      programs: ['engine'],
      playlists: { engine: { targets: [{ id: '7', name: 'House' }] } },
      fromSerato: true,
      seratoPlaylists: [{ id: 'A', name: 'A' }],
      rekordboxPlaylistsBase: ['1'],
    })
    expect(read).toEqual({
      meta,
      programs: ['engine'],
      playlists: { engine: { targets: [{ id: '7', name: 'House' }] } },
    })
  })
})

describe('withLegacy', () => {
  it('writes what an older version reads', () => {
    for (const edit of Object.values(TODAY))
      expect(olderVersionReads(withLegacy(fromLegacy(edit)))).toEqual(olderVersionReads(edit))
    const everything: Saved = {
      meta,
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
      rekordboxPlaylists: [{ name: 'Cierre' }],
      rekordboxPlaylistsBase: ['1'],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      traktorPlaylistsBase: [],
      enginePlaylists: [],
      enginePlaylistsBase: ['2'],
      seratoPlaylists: [{ id: 's', name: 'S' }],
      seratoPlaylistsBase: ['crate-a'],
    }
    expect(olderVersionReads(withLegacy(fromLegacy(everything)))).toEqual(
      olderVersionReads(everything),
    )
  })

  it('keeps the new fields beside the old ones, so this version reads its own session back', () => {
    const edit: SessionEdit = {
      meta,
      programs: ['serato'],
      playlists: { serato: { targets: [{ id: 'A', name: 'A' }] } },
    }
    expect(fromLegacy(withLegacy(edit))).toEqual(edit)
    expect(withLegacy(edit)).toMatchObject(edit)
  })

  it('writes no old key for a track with no origin or playlists', () => {
    expect(withLegacy({ meta })).toEqual({ meta })
  })
})

describe('the quirks an older version relies on', () => {
  it('keeps a lone base and a missing base as they are', () => {
    const loneBase: Saved = { meta, seratoPlaylistsBase: ['old'] }
    const noBase: Saved = { meta, rekordboxPlaylists: [{ name: 'R' }] }
    const emptyBase: Saved = {
      meta,
      traktorPlaylists: [{ id: 't', name: 'T' }],
      traktorPlaylistsBase: [],
    }

    expect(fromLegacy(loneBase).playlists).toEqual({ serato: { base: ['old'] } })
    expect(fromLegacy(noBase).playlists).toEqual({ rekordbox: { targets: [{ name: 'R' }] } })
    expect(fromLegacy(emptyBase).playlists).toEqual({
      traktor: { targets: [{ id: 't', name: 'T' }], base: [] },
    })

    expect(withLegacy(fromLegacy(loneBase))).toMatchObject(loneBase)
    expect(withLegacy(fromLegacy(noBase))).toMatchObject(noBase)
    expect('rekordboxPlaylistsBase' in withLegacy(fromLegacy(noBase))).toBe(false)
    expect(withLegacy(fromLegacy(emptyBase))).toMatchObject({ traktorPlaylistsBase: [] })
  })
})
