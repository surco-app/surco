import { describe, expect, it, vi } from 'vitest'
import { createCuesApi } from './cues'

const OLD_METHODS = [
  'rekordboxTrackCues',
  'rekordboxCueWaveDetail',
  'rekordboxCueWaveFine',
  'rekordboxCueDropInput',
  'rekordboxCueTwins',
  'rekordboxAuditionLead',
  'rekordboxSurcoGrid',
  'rekordboxGridFit',
  'rekordboxGridVerdict',
  'rekordboxQueuedCues',
  'undoRekordboxCues',
  'saveRekordboxCues',
]

const REQUESTS = [{ contentId: 'serato:/m/a.mp3', path: '/m/a.mp3', label: 'a', wanted: [] }]

describe('createCuesApi', () => {
  it.each([
    ['trackCues', 'cues:trackCues', ['engine:4']],
    ['waveDetail', 'cues:waveDetail', ['engine:4']],
    ['waveFine', 'cues:waveFine', ['engine:4']],
    ['dropInput', 'cues:dropInput', ['engine:4']],
    ['twins', 'cues:twins', ['/m/a.aiff']],
    ['auditionLead', 'cues:auditionLead', ['engine:4']],
    ['surcoGrid', 'cues:surcoGrid', ['engine:4']],
    ['gridFit', 'cues:gridFit', ['engine:4', 'low']],
    ['queued', 'cues:queued', ['engine:4']],
    ['undo', 'cues:undo', ['engine:4']],
    ['save', 'cues:save', [REQUESTS]],
  ] as const)(
    'invokes its own channel with the same arguments for %s',
    async (op, channel, args) => {
      const ipc = { invoke: vi.fn(async () => undefined) }
      const api = createCuesApi(ipc)
      const call = api[op] as (...a: unknown[]) => Promise<unknown>
      await call(...args)
      expect(ipc.invoke).toHaveBeenCalledWith(channel, ...args)
    },
  )
})

describe('the preload bridge', () => {
  it('no longer exposes the rekordbox-named cue methods, so nothing can reach a channel main stopped serving', async () => {
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
    expect(Object.keys(api).filter((k) => OLD_METHODS.includes(k))).toEqual([])
    expect(typeof api.cues).toBe('object')
    vi.doUnmock('electron')
  })
})
