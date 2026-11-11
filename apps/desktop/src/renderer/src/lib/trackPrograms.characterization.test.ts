import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { sessionEdits } from './sessionEdits'
import { copyFlags, copyPlaylists, jobPlaylists, TRACK_PROGRAMS } from './trackPrograms'

type Fields = Parameters<typeof copyFlags>[0]

function staged(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'id-1',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
    query: '',
    listLabel: 'a',
    status: 'idle',
    meta: { title: 'Edited' } as TrackItem['meta'],
    diskSignature: trackSignature({ meta: { title: 'Disk' } as TrackItem['meta'] }),
    ...over,
  }
}

const ALL_FLAGS = ['fromRekordbox', 'fromEngine', 'fromTraktor', 'fromSerato'] as const
const PROGRAMS = ['rekordbox', 'traktor', 'engine', 'serato'] as const

describe('TRACK_PROGRAMS', () => {
  it('names each program’s flag and playlist fields, since saved sessions and jobs already carry these exact keys', () => {
    expect(PROGRAMS.map((p) => TRACK_PROGRAMS[p])).toEqual([
      expect.objectContaining({
        flag: 'fromRekordbox',
        playlists: 'rekordboxPlaylists',
        playlistsBase: 'rekordboxPlaylistsBase',
      }),
      expect.objectContaining({
        flag: 'fromTraktor',
        playlists: 'traktorPlaylists',
        playlistsBase: 'traktorPlaylistsBase',
      }),
      expect.objectContaining({
        flag: 'fromEngine',
        playlists: 'enginePlaylists',
        playlistsBase: 'enginePlaylistsBase',
      }),
      expect.objectContaining({
        flag: 'fromSerato',
        playlists: 'seratoPlaylists',
        playlistsBase: 'seratoPlaylistsBase',
      }),
    ])
  })
})

describe('copyFlags', () => {
  it.each(ALL_FLAGS)(
    'carries %s so a reopened or merged row keeps knowing where it came from',
    (flag) => {
      const to: Fields = {}
      copyFlags({ [flag]: true }, to)
      expect(to).toEqual({ [flag]: true })
    },
  )

  it('carries every flag a track has at once, since a file can sit in several libraries', () => {
    const to: Fields = {}
    copyFlags({ fromRekordbox: true, fromEngine: true, fromTraktor: true, fromSerato: true }, to)
    expect(to).toEqual({
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
    })
  })

  it('never copies a false flag, so a stored session stays free of absent origins', () => {
    const to: Fields = {}
    copyFlags({ fromRekordbox: false, fromSerato: false }, to)
    expect(to).toEqual({})
  })

  it('does not clear a flag the target already has when the source lacks it, so merging never loses an origin', () => {
    const to: Fields = { fromTraktor: true }
    copyFlags({ fromTraktor: false }, to)
    expect(to).toEqual({ fromTraktor: true })
  })

  it('leaves flags it does not know about out of the target', () => {
    const to: Fields = {}
    copyFlags({ rekordboxPlaylists: [{ name: 'A' }] }, to)
    expect(to).toEqual({})
  })
})

describe('copyPlaylists', () => {
  it('copies a staged base even when there are no targets, so a reopened track still knows which playlists it was already in', () => {
    const to: Fields = {}
    copyPlaylists({ rekordboxPlaylistsBase: ['3000'], seratoPlaylistsBase: ['A'] }, to)
    expect(to).toEqual({ rekordboxPlaylistsBase: ['3000'], seratoPlaylistsBase: ['A'] })
  })

  it('copies targets without a base, leaving the base missing rather than inventing one', () => {
    const to: Fields = {}
    copyPlaylists({ traktorPlaylists: [{ id: 'fri', name: 'Friday' }] }, to)
    expect(to).toEqual({ traktorPlaylists: [{ id: 'fri', name: 'Friday' }] })
    expect('traktorPlaylistsBase' in to).toBe(false)
  })

  it('copies an empty target list, since [] is the user’s choice to leave every playlist', () => {
    const to: Fields = {}
    copyPlaylists({ enginePlaylists: [], enginePlaylistsBase: [] }, to)
    expect(to).toEqual({ enginePlaylists: [], enginePlaylistsBase: [] })
  })

  it('keeps each program’s playlists apart from the others', () => {
    const to: Fields = {}
    copyPlaylists(
      {
        rekordboxPlaylists: [{ name: 'R' }],
        traktorPlaylists: [{ id: 't', name: 'T' }],
        enginePlaylists: [{ id: 'e', name: 'E' }],
        seratoPlaylists: [{ id: 's', name: 'S' }],
      },
      to,
    )
    expect(to).toEqual({
      rekordboxPlaylists: [{ name: 'R' }],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      enginePlaylists: [{ id: 'e', name: 'E' }],
      seratoPlaylists: [{ id: 's', name: 'S' }],
    })
  })

  it('shares the source arrays instead of cloning them', () => {
    const targets = [{ id: 's', name: 'S' }]
    const base = ['s']
    const to: Fields = {}
    copyPlaylists({ seratoPlaylists: targets, seratoPlaylistsBase: base }, to)
    expect(to.seratoPlaylists).toBe(targets)
    expect(to.seratoPlaylistsBase).toBe(base)
  })

  it('does not touch what the target holds when the source has nothing staged', () => {
    const to: Fields = { rekordboxPlaylists: [{ name: 'Keep' }], rekordboxPlaylistsBase: ['1'] }
    copyPlaylists({}, to)
    expect(to).toEqual({ rekordboxPlaylists: [{ name: 'Keep' }], rekordboxPlaylistsBase: ['1'] })
  })

  it('overwrites the target’s playlists with the source’s when both have them', () => {
    const to: Fields = { traktorPlaylists: [{ id: 'old', name: 'Old' }] }
    copyPlaylists({ traktorPlaylists: [{ id: 'new', name: 'New' }] }, to)
    expect(to.traktorPlaylists).toEqual([{ id: 'new', name: 'New' }])
  })

  it('ignores flags', () => {
    const to: Fields = {}
    copyPlaylists({ fromRekordbox: true }, to)
    expect(to).toEqual({})
  })
})

describe('jobPlaylists', () => {
  it('sends the base of a program without targets, leaving main to decide it is not wanted', () => {
    expect(jobPlaylists({ enginePlaylistsBase: ['7'] })).toMatchObject({
      enginePlaylists: undefined,
      enginePlaylistsBase: ['7'],
    })
  })

  it('sends empty lists as they are, so leaving every playlist reaches main', () => {
    expect(jobPlaylists({ traktorPlaylists: [], traktorPlaylistsBase: [] })).toMatchObject({
      traktorPlaylists: [],
      traktorPlaylistsBase: [],
    })
  })

  it('sends all four programs’ playlists in one job', () => {
    const job = jobPlaylists({
      rekordboxPlaylists: [{ name: 'R' }],
      rekordboxPlaylistsBase: ['1'],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      enginePlaylists: [{ id: 'e', name: 'E' }],
      enginePlaylistsBase: ['2'],
      seratoPlaylists: [{ id: 's', name: 'S' }],
    })
    expect(job).toEqual({
      rekordboxPlaylists: [{ name: 'R' }],
      rekordboxPlaylistsBase: ['1'],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      traktorPlaylistsBase: undefined,
      enginePlaylists: [{ id: 'e', name: 'E' }],
      enginePlaylistsBase: ['2'],
      seratoPlaylists: [{ id: 's', name: 'S' }],
      seratoPlaylistsBase: undefined,
    })
  })

  it('never carries origin flags into the job', () => {
    expect(Object.keys(jobPlaylists({ fromSerato: true, fromRekordbox: true }))).not.toContain(
      'fromSerato',
    )
  })
})

describe('sessionEdits origin and playlists', () => {
  it.each(ALL_FLAGS)(
    'writes %s true into the saved edit and nothing for the other origins',
    (flag) => {
      const edit = sessionEdits([staged({ [flag]: true })])['/music/a.wav']
      for (const other of ALL_FLAGS) expect(edit[other]).toBe(other === flag ? true : undefined)
    },
  )

  it('omits a false flag from the saved edit', () => {
    const edit = sessionEdits([staged({ fromEngine: false })])['/music/a.wav']
    expect('fromEngine' in edit).toBe(false)
  })

  it('writes staged playlists with their base, empty lists included', () => {
    const edit = sessionEdits([
      staged({
        rekordboxPlaylists: [{ name: 'R' }],
        rekordboxPlaylistsBase: ['1'],
        seratoPlaylists: [],
        seratoPlaylistsBase: [],
      }),
    ])['/music/a.wav']
    expect(edit).toMatchObject({
      rekordboxPlaylists: [{ name: 'R' }],
      rekordboxPlaylistsBase: ['1'],
      seratoPlaylists: [],
      seratoPlaylistsBase: [],
    })
  })

  it('writes a base without targets, so the reopened row still knows its membership', () => {
    const edit = sessionEdits([staged({ traktorPlaylistsBase: ['old'] })])['/music/a.wav']
    expect(edit.traktorPlaylistsBase).toEqual(['old'])
    expect('traktorPlaylists' in edit).toBe(false)
  })

  it('writes no playlist or flag keys for a track with none', () => {
    const edit = sessionEdits([staged()])['/music/a.wav']
    expect(Object.keys(edit)).toEqual(['meta'])
  })

  it('round-trips through the restore copies, which is how a reopened row gets its origin and playlists back', () => {
    const edit = sessionEdits([
      staged({
        fromRekordbox: true,
        fromSerato: true,
        rekordboxPlaylists: [{ name: 'R' }],
        traktorPlaylistsBase: ['old'],
        enginePlaylists: [],
      }),
    ])['/music/a.wav']
    const patch: Fields = {}
    copyFlags(edit, patch)
    copyPlaylists(edit, patch)
    expect(patch).toEqual({
      fromRekordbox: true,
      fromSerato: true,
      rekordboxPlaylists: [{ name: 'R' }],
      traktorPlaylistsBase: ['old'],
      enginePlaylists: [],
    })
  })
})
