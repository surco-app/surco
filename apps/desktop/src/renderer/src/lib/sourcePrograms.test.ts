// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type DjProgram, RAIL_PROGRAMS } from '../../../shared/djProgram'
import type { RekordboxPlaylistEdit, SourceNode } from '../../../shared/types'
import { installApi } from '../test/api'
import { SOURCE_PROGRAMS, SOURCE_READ } from './sourcePrograms'

describe('SOURCE_READ reads each DJ program’s tab from that program’s own bridge', () => {
  it.each([
    ['rekordbox', 'available', 'rekordboxAvailable', []],
    ['rekordbox', 'tree', 'loadRekordboxTree', []],
    ['rekordbox', 'recentCount', 'rekordboxRecentCount', []],
    ['rekordbox', 'trackCount', 'rekordboxTrackCount', []],
    ['rekordbox', 'playlist', 'loadRekordboxPlaylist', ['house']],
    ['rekordbox', 'membership', 'rekordboxMembership', [['/m/a.wav']]],
    ['traktor', 'available', 'traktorAvailable', []],
    ['traktor', 'tree', 'loadTraktorTree', []],
    ['traktor', 'recentCount', 'traktorRecentCount', []],
    ['traktor', 'trackCount', 'traktorTrackCount', []],
    ['traktor', 'playlist', 'loadTraktorPlaylist', ['u1']],
    ['traktor', 'membership', 'traktorMembership', [['/m/a.wav']]],
    ['engine', 'available', 'engineAvailable', []],
    ['engine', 'tree', 'loadEngineTree', []],
    ['engine', 'recentCount', 'engineRecentCount', []],
    ['engine', 'trackCount', 'engineTrackCount', []],
    ['engine', 'playlist', 'loadEnginePlaylist', ['7']],
    ['engine', 'membership', 'engineMembership', [['/m/a.wav']]],
    ['serato', 'available', 'seratoAvailable', []],
    ['serato', 'tree', 'loadSeratoTree', []],
    ['serato', 'recentCount', 'seratoRecentCount', []],
    ['serato', 'trackCount', 'seratoTrackCount', []],
    ['serato', 'playlist', 'loadSeratoPlaylist', ['Sets%%Friday']],
    ['serato', 'membership', 'seratoMembership', [['/m/a.wav']]],
  ] as const)(
    'reads %s’s %s through window.api.%s at call time',
    async (program, read, method, args) => {
      const answer = Symbol(method)
      const spy = vi.fn(async () => answer)
      installApi({ [method]: spy } as Partial<Api>)
      const call = SOURCE_READ[program][read] as (...a: unknown[]) => Promise<unknown>
      await expect(call(...args)).resolves.toBe(answer)
      expect(spy).toHaveBeenCalledWith(...args)
    },
  )
})

describe('RAIL_PROGRAMS', () => {
  it('draws rekordbox, then Engine DJ, then Traktor, after Music, as the rail always has, and Serato last', () => {
    expect(RAIL_PROGRAMS).toEqual(['rekordbox', 'engine', 'traktor', 'serato'])
  })
})

describe('SOURCE_PROGRAMS says what each DJ program allows in its tab', () => {
  const shape = (program: DjProgram) => {
    const { separator, edit, fixedNode, ...rest } = SOURCE_PROGRAMS[program]
    return {
      ...rest,
      separator: separator !== null,
      edit: edit && { messagePrefix: edit.messagePrefix, gate: edit.gate },
      fixedNode: fixedNode !== null,
    }
  }

  it('lets rekordbox be edited at any time, export to USB, fill loaded rows and add tracks it lacks', () => {
    expect(shape('rekordbox')).toEqual({
      separator: true,
      edit: { messagePrefix: 'sources.edit.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: false,
      trackFlag: 'fromRekordbox',
      fillsLoaded: true,
      addsUncollected: true,
      fieldTestIdPrefix: '',
      membershipKey: 'rekordbox-membership',
      invalidatesOnEdit: true,
      crates: false,
    })
  })

  it('lets Traktor be edited once its collection is confirmed, with its own built-in lists fixed, and export to USB', () => {
    expect(shape('traktor')).toEqual({
      separator: true,
      edit: { messagePrefix: 'sources.editTraktor.', gate: 'traktorCollection' },
      fixedNode: true,
      usb: true,
      missingLibraryCheck: false,
      trackFlag: 'fromTraktor',
      fillsLoaded: false,
      addsUncollected: false,
      fieldTestIdPrefix: 'traktor-',
      membershipKey: 'traktor-membership',
      invalidatesOnEdit: true,
      crates: false,
    })
  })

  it('only reads Engine DJ, exports it to USB and says when its library is missing', () => {
    expect(shape('engine')).toEqual({
      separator: false,
      edit: null,
      fixedNode: false,
      usb: true,
      missingLibraryCheck: true,
      trackFlag: null,
      fillsLoaded: false,
      addsUncollected: false,
      fieldTestIdPrefix: 'engine-',
      membershipKey: 'engine-membership',
      invalidatesOnEdit: false,
      crates: false,
    })
  })

  it('lets the Serato tab edit crates with no separator, no folders and no gate, and export to USB', () => {
    expect(shape('serato')).toEqual({
      separator: false,
      edit: { messagePrefix: 'sources.editSerato.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: false,
      trackFlag: 'fromSerato',
      fillsLoaded: false,
      addsUncollected: true,
      fieldTestIdPrefix: 'serato-',
      membershipKey: 'serato-membership',
      invalidatesOnEdit: true,
      crates: true,
    })
  })

  it('saves a Serato edit through editSeratoPlaylist with the crate name for the queue', async () => {
    const editSeratoPlaylist = vi
      .fn<Api['editSeratoPlaylist']>()
      .mockResolvedValue({ applied: true })
    installApi({ editSeratoPlaylist })
    await SOURCE_PROGRAMS.serato.edit?.save({ kind: 'rename', playlistId: 'A', name: 'B' }, 'A')
    expect(editSeratoPlaylist).toHaveBeenCalledWith(
      { kind: 'rename', playlistId: 'A', name: 'B' },
      'A',
    )
  })

  it.each([
    ['rekordbox', 'rekordboxHasSeparator'],
    ['traktor', 'traktorHasSeparator'],
  ] as const)('asks %s for a separator through window.api.%s', async (program, method) => {
    const spy = vi.fn(async () => true)
    installApi({ [method]: spy } as Partial<Api>)
    await expect(SOURCE_PROGRAMS[program].separator?.()).resolves.toBe(true)
    expect(spy).toHaveBeenCalled()
  })

  it.each([
    ['rekordbox', 'editRekordboxPlaylist'],
    ['traktor', 'editTraktorPlaylist'],
  ] as const)('saves an edit to %s through window.api.%s', async (program, method) => {
    const edit: RekordboxPlaylistEdit = { kind: 'rename', playlistId: 'p', name: 'B' }
    const spy = vi.fn(async () => ({ applied: true as const }))
    installApi({ [method]: spy } as Partial<Api>)
    await expect(SOURCE_PROGRAMS[program].edit?.save(edit, 'A')).resolves.toEqual({
      applied: true,
    })
    expect(spy).toHaveBeenCalledWith(edit, 'A')
  })

  it.each([
    ['HISTORY', true, 'locked'],
    ['Preparation', true, 'tracks-only'],
    ['_LOOPS', true, 'tracks-only'],
    ['_RECORDINGS', true, 'tracks-only'],
    ['HISTORY', false, null],
    ['Saturday', true, null],
  ] as const)('fixes Traktor’s %s at the root (%s) as %s', (name, atRoot, fixed) => {
    const node: SourceNode = { id: 'n', name, kind: 'playlist', count: 0 }
    expect(SOURCE_PROGRAMS.traktor.fixedNode?.(node, atRoot)).toBe(fixed)
  })
})
