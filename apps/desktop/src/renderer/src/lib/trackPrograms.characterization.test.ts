// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DjProgram } from '../../../shared/djProgram'
import { emptyMetadata } from '../../../shared/metadata'
import type { LegacyOrigin } from '../../../shared/sessionLegacy'
import type { SessionEdit } from '../../../shared/types'
import { useTrackLibrary } from '../hooks/useTrackLibrary'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { sessionEdits } from './sessionEdits'
import { jobPlaylists } from './trackPrograms'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const PATH = '/m/a.wav'
const PROGRAMS: DjProgram[] = ['rekordbox', 'engine', 'traktor', 'serato']
const LIBRARIES = ['rekordbox', 'traktor', 'engine', 'serato'] as const
type Library = (typeof LIBRARIES)[number]

const FLAG_KEYS = ['fromRekordbox', 'fromEngine', 'fromTraktor', 'fromSerato'] as const
const PLAYLIST_KEYS = [
  'rekordboxPlaylists',
  'rekordboxPlaylistsBase',
  'traktorPlaylists',
  'traktorPlaylistsBase',
  'enginePlaylists',
  'enginePlaylistsBase',
  'seratoPlaylists',
  'seratoPlaylistsBase',
] as const
const ORIGIN_KEYS = [...FLAG_KEYS, ...PLAYLIST_KEYS]

interface Staged {
  origins?: DjProgram[]
  falseOrigins?: DjProgram[]
  playlists?: Partial<
    Record<Library, { targets?: { id?: string; name: string }[]; base?: string[] }>
  >
}

const FLAG_OF: Record<DjProgram, (typeof FLAG_KEYS)[number]> = {
  rekordbox: 'fromRekordbox',
  engine: 'fromEngine',
  traktor: 'fromTraktor',
  serato: 'fromSerato',
}

function trackWith({ origins = [], playlists }: Staged = {}): TrackItem {
  const fields: Partial<TrackItem> = {}
  if (origins.length > 0) fields.programs = origins
  if (playlists) fields.playlists = playlists
  return {
    id: 'id-1',
    inputPath: PATH,
    fileName: 'a.wav',
    query: '',
    listLabel: 'a',
    status: 'idle',
    meta: { ...emptyMetadata(), title: 'Edited' },
    diskSignature: trackSignature({ meta: { title: 'Disk' } as TrackItem['meta'] }),
    ...fields,
  }
}

function savedSession(staged: Staged): SessionEdit {
  return sessionEdits([trackWith(staged)])[PATH]
}

function originKeysOf(edit: SessionEdit): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(edit).filter(([key]) => (ORIGIN_KEYS as readonly string[]).includes(key)),
  )
}

async function restoreAndResave(saved: SessionEdit): Promise<SessionEdit> {
  ;(window as unknown as { api: unknown }).api = {
    takePendingFiles: vi.fn().mockResolvedValue([]),
    onOpenFiles: vi.fn(() => () => {}),
    onExpandedBatch: vi.fn(() => () => {}),
    onFoldersChanged: vi.fn(() => () => {}),
    onFilesChanged: vi.fn(() => () => {}),
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    expandPaths: vi.fn().mockResolvedValue([]),
    readMeta: vi.fn().mockResolvedValue({
      tags: { title: '', artist: '' },
      duration: 180,
      cover: null,
      foreignTags: [],
    }),
    recordStat: vi.fn(),
  }
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped: vi.fn(),
      onNoAudioFound: vi.fn(),
      onMetaReadFailed: vi.fn(),
    }),
  )
  await act(() => result.current.addPaths([PATH], { [PATH]: saved }))
  return sessionEdits(result.current.tracks)[PATH]
}

async function afterReopen(staged: Staged): Promise<Record<string, unknown>> {
  return originKeysOf(await restoreAndResave(savedSession(staged)))
}

describe('the saved session carries where a track came from', () => {
  it.each(PROGRAMS)('writes only the %s origin key for a track opened from it', (program) => {
    expect(originKeysOf(savedSession({ origins: [program] }))).toEqual({
      [FLAG_OF[program]]: true,
    })
  })

  it('writes every origin key for a file that sits in several libraries', () => {
    expect(originKeysOf(savedSession({ origins: PROGRAMS }))).toEqual({
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
    })
  })

  it('leaves out an origin that is false, so a stored session stays free of absent origins', () => {
    expect(originKeysOf(savedSession({ falseOrigins: ['serato', 'rekordbox'] }))).toEqual({})
  })

  it('writes no origin or playlist key for a track with none', () => {
    expect(Object.keys(savedSession({}))).toEqual(['meta'])
  })
})

describe('the saved session carries staged playlists', () => {
  it('writes targets and base per program, empty lists included, so leaving every playlist survives a crash', () => {
    expect(
      originKeysOf(
        savedSession({
          playlists: {
            rekordbox: { targets: [{ name: 'R' }], base: ['1'] },
            serato: { targets: [], base: [] },
          },
        }),
      ),
    ).toEqual({
      rekordboxPlaylists: [{ name: 'R' }],
      rekordboxPlaylistsBase: ['1'],
      seratoPlaylists: [],
      seratoPlaylistsBase: [],
    })
  })

  it.each(LIBRARIES)(
    'writes a %s base without targets, so the reopened row still knows which playlists it was already in',
    (program) => {
      expect(originKeysOf(savedSession({ playlists: { [program]: { base: ['old'] } } }))).toEqual({
        [`${program}PlaylistsBase`]: ['old'],
      })
    },
  )

  it.each(LIBRARIES)('writes %s targets without a base and does not invent one', (program) => {
    const keys = originKeysOf(
      savedSession({ playlists: { [program]: { targets: [{ id: 'x', name: 'X' }] } } }),
    )
    expect(keys).toEqual({ [`${program}Playlists`]: [{ id: 'x', name: 'X' }] })
  })

  it('keeps each program’s playlists apart from the others', () => {
    const playlists = {
      rekordbox: { targets: [{ name: 'R' }] },
      traktor: { targets: [{ id: 't', name: 'T' }] },
      engine: { targets: [{ id: 'e', name: 'E' }] },
      serato: { targets: [{ id: 's', name: 'S' }] },
    }
    expect(originKeysOf(savedSession({ playlists }))).toEqual({
      rekordboxPlaylists: [{ name: 'R' }],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      enginePlaylists: [{ id: 'e', name: 'E' }],
      seratoPlaylists: [{ id: 's', name: 'S' }],
    })
  })
})

describe('reopening a saved session', () => {
  it.each(PROGRAMS)('gives a reopened %s row its origin back', async (program) => {
    expect(await afterReopen({ origins: [program] })).toEqual({ [FLAG_OF[program]]: true })
  })

  it('gives a reopened row every origin it had', async () => {
    expect(await afterReopen({ origins: PROGRAMS })).toEqual({
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
    })
  })

  it('does not bring back an origin that was saved as false', async () => {
    const saved = { ...savedSession({}), fromSerato: false }
    expect(originKeysOf(await restoreAndResave(saved))).toEqual({})
  })

  it.each(LIBRARIES)(
    'keeps a staged %s base without targets across save, reopen and save, so the row still knows its membership',
    async (program) => {
      expect(await afterReopen({ playlists: { [program]: { base: ['old'] } } })).toEqual({
        [`${program}PlaylistsBase`]: ['old'],
      })
    },
  )

  it('keeps targets without a base from growing one: rekordbox stays absent, an empty base stays empty', async () => {
    const keys = await afterReopen({
      playlists: {
        rekordbox: { targets: [{ name: 'R' }] },
        traktor: { targets: [{ id: 't', name: 'T' }], base: [] },
      },
    })
    expect(keys).toEqual({
      rekordboxPlaylists: [{ name: 'R' }],
      traktorPlaylists: [{ id: 't', name: 'T' }],
      traktorPlaylistsBase: [],
    })
    expect('rekordboxPlaylistsBase' in keys).toBe(false)
  })

  it('restores a literal session written today with every origin, a rekordbox target, a Traktor empty base and a Serato base alone', async () => {
    const saved: SessionEdit & LegacyOrigin = {
      meta: { ...emptyMetadata(), title: 'Restored' },
      fromRekordbox: true,
      fromEngine: true,
      fromTraktor: true,
      fromSerato: true,
      rekordboxPlaylists: [{ name: 'Cierre' }],
      traktorPlaylistsBase: [],
      seratoPlaylistsBase: ['crate-a'],
    }
    expect(originKeysOf(await restoreAndResave(saved))).toEqual(originKeysOf(saved))
  })

  it('restores nothing for a saved session that has no origin or playlists', async () => {
    const saved: SessionEdit = { meta: { ...emptyMetadata(), title: 'Restored' } }
    expect(originKeysOf(await restoreAndResave(saved))).toEqual({})
  })
})

describe('jobPlaylists', () => {
  it('sends the base of a program without targets, leaving main to decide it is not wanted', () => {
    expect(jobPlaylists(trackWith({ playlists: { engine: { base: ['7'] } } }))).toEqual({
      playlists: { engine: { base: ['7'] } },
    })
  })

  it('sends empty lists as they are, so leaving every playlist reaches main', () => {
    expect(jobPlaylists(trackWith({ playlists: { traktor: { targets: [], base: [] } } }))).toEqual({
      playlists: { traktor: { targets: [], base: [] } },
    })
  })

  it('sends all four programs’ playlists in one job', () => {
    const job = jobPlaylists(
      trackWith({
        playlists: {
          rekordbox: { targets: [{ name: 'R' }], base: ['1'] },
          traktor: { targets: [{ id: 't', name: 'T' }] },
          engine: { targets: [{ id: 'e', name: 'E' }], base: ['2'] },
          serato: { targets: [{ id: 's', name: 'S' }] },
        },
      }),
    )
    expect(job).toEqual({
      playlists: {
        rekordbox: { targets: [{ name: 'R' }], base: ['1'] },
        traktor: { targets: [{ id: 't', name: 'T' }], base: undefined },
        engine: { targets: [{ id: 'e', name: 'E' }], base: ['2'] },
        serato: { targets: [{ id: 's', name: 'S' }], base: undefined },
      },
    })
  })

  it('never carries any origin into the job', () => {
    const keys = Object.keys(jobPlaylists(trackWith({ origins: PROGRAMS })))
    expect(keys).not.toContain('programs')
  })
})
