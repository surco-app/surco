import { describe, expect, it, vi } from 'vitest'
import { createDjApi } from './dj'

const OLD_READ_METHODS = [
  'rekordboxAvailable',
  'loadRekordboxTree',
  'rekordboxRecentCount',
  'rekordboxTrackCount',
  'loadRekordboxPlaylist',
  'rekordboxMembership',
  'loadRekordboxCollection',
  'engineAvailable',
  'loadEngineTree',
  'engineRecentCount',
  'engineTrackCount',
  'loadEnginePlaylist',
  'engineMembership',
  'traktorAvailable',
  'loadTraktorTree',
  'traktorRecentCount',
  'traktorTrackCount',
  'loadTraktorPlaylist',
  'traktorMembership',
  'loadTraktorCollection',
  'seratoAvailable',
  'loadSeratoTree',
  'seratoRecentCount',
  'seratoTrackCount',
  'loadSeratoPlaylist',
  'seratoMembership',
  'loadSeratoCollection',
]

function fakeIpc() {
  return { invoke: vi.fn(async () => undefined), on: vi.fn(), removeListener: vi.fn() }
}

describe('createDjApi', () => {
  it.each([
    ['available', 'dj:available', []],
    ['tree', 'dj:tree', []],
    ['recentCount', 'dj:recentCount', []],
    ['trackCount', 'dj:trackCount', []],
    ['playlist', 'dj:playlist', ['p1']],
    ['membership', 'dj:membership', [['/m/a.wav']]],
    ['collection', 'dj:collection', []],
  ] as const)(
    'invokes the shared channel with the program first for %s, so one channel serves every program',
    async (op, channel, rest) => {
      const ipc = fakeIpc()
      const api = createDjApi(ipc)
      const call = api[op] as (...a: unknown[]) => Promise<unknown>
      await call('serato', ...rest)
      expect(ipc.invoke).toHaveBeenCalledWith(channel, 'serato', ...rest)
    },
  )
})

describe('the preload bridge', () => {
  it('no longer exposes the per-program read methods, so nothing can reach a channel main stopped serving', async () => {
    vi.resetModules()
    const exposed = vi.fn()
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: exposed },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn(),
        sendSync: vi.fn(() => '0.0.0'),
      },
      webUtils: { getPathForFile: vi.fn() },
    }))
    await import('./index')
    const api = exposed.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).filter((k) => OLD_READ_METHODS.includes(k))).toEqual([])
    expect(typeof api.dj).toBe('object')
    vi.doUnmock('electron')
  })
})
