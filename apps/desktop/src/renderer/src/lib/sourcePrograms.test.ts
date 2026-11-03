// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { RAIL_PROGRAMS } from '../../../shared/djProgram'
import { installApi } from '../test/api'
import { SOURCE_READ } from './sourcePrograms'

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
  it('draws rekordbox, then Engine DJ, then Traktor, after Music, as the rail always has', () => {
    expect(RAIL_PROGRAMS).toEqual(['rekordbox', 'engine', 'traktor'])
  })
})
