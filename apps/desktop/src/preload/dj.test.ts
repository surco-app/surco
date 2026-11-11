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

const OLD_EDIT_METHODS = [
  'editRekordboxPlaylist',
  'editTraktorPlaylist',
  'editSeratoPlaylist',
  'rekordboxHasSeparator',
  'traktorHasSeparator',
]

const OLD_QUEUE_METHODS = ['rekordbox', 'engine', 'traktor', 'serato'].flatMap((p) => {
  const P = p[0].toUpperCase() + p.slice(1)
  const stem = p === 'rekordbox' ? `${P}Queue` : `${P}CueQueue`
  const lower = p === 'rekordbox' ? 'rekordboxQueue' : `${p}CueQueue`
  return [
    lower,
    `apply${stem}`,
    `discard${stem}`,
    `${lower}Ready`,
    `on${stem}Changed`,
    `on${stem}Applied`,
  ]
})

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
    ['editPlaylist', 'dj:editPlaylist', [{ kind: 'delete', playlistId: 'p' }, 'Friday']],
    ['hasSeparator', 'dj:hasSeparator', []],
    ['cueQueue', 'dj:cueQueue', []],
    ['applyCueQueue', 'dj:applyCueQueue', []],
    ['discardCueQueue', 'dj:discardCueQueue', []],
    ['cueQueueReady', 'dj:cueQueueReady', []],
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

describe.each([
  ['onCueQueueChanged', 'dj:cueQueueChanged'],
  ['onCueQueueApplied', 'dj:cueQueueApplied'],
] as const)('%s', (op, channel) => {
  function subscribed() {
    const listeners = new Set<(e: unknown, p: unknown) => void>()
    const ipc = {
      invoke: vi.fn(async () => undefined),
      on: vi.fn((ch: string, l: (e: unknown, p: unknown) => void) => {
        if (ch === channel) listeners.add(l)
      }),
      removeListener: vi.fn((_ch: string, l: (e: unknown, p: unknown) => void) => {
        listeners.delete(l)
      }),
    }
    const api = createDjApi(ipc as unknown as Parameters<typeof createDjApi>[0])
    const emit = (payload: unknown) => {
      for (const listener of [...listeners]) listener({}, payload)
    }
    return { ipc, api, emit }
  }

  it('delivers a queue event only to listeners of its program, so one program never repaints another pill', () => {
    const { api, emit } = subscribed()
    const serato = vi.fn()
    const engine = vi.fn()
    api[op]('serato', serato)
    api[op]('engine', engine)
    const value = { tracks: 1, changes: 0, items: [] }
    emit({ program: 'engine', value })
    expect(engine).toHaveBeenCalledWith(value)
    expect(serato).not.toHaveBeenCalled()
  })

  it('stops delivering after the returned unsubscribe', () => {
    const { ipc, api, emit } = subscribed()
    const cb = vi.fn()
    const off = api[op]('traktor', cb)
    const listener = ipc.on.mock.calls[0][1]
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith(channel, listener)
    emit({ program: 'traktor', value: {} })
    expect(cb).not.toHaveBeenCalled()
  })
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
    expect(Object.keys(api).filter((k) => OLD_EDIT_METHODS.includes(k))).toEqual([])
    expect(Object.keys(api).filter((k) => OLD_QUEUE_METHODS.includes(k))).toEqual([])
    expect(typeof api.dj).toBe('object')
    vi.doUnmock('electron')
  })
})
