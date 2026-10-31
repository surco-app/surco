import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { isPackaged: false } }))

import { ipcMain } from 'electron'
import { registerDamageIpc } from './damageIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as never
}

const MP3 = '/m/uno.mp3'

beforeEach(() => vi.clearAllMocks())

// A repair held while Traktor or Engine DJ stays open lands later. Until it does, the scan
// still finds the damage, and staging it again would queue the same shift twice.
describe('damage:scan', () => {
  it('marks a Traktor finding whose entry patch waits in the queue', async () => {
    const entry = { volume: 'Macintosh HD', dir: '/:m/:', file: 'uno.mp3', entryState: 'S' }
    registerDamageIpc({
      scanDeps: () => ({
        isAllowed: () => true,
        readGenre: async () => null,
        libraryGenres: async () => ({}),
        traktor: async () => [
          {
            path: MP3,
            sibling: '/m/uno.aiff',
            judgement: {
              kind: 'traktor-source-cues' as const,
              certainty: 'sure' as const,
              addMs: 51.18,
              fixEntry: 'source' as const,
              fixTree: false,
              provenance: true,
            },
            before: [{ type: 0, hotcue: 0, ms: 9948.82 }],
            entry,
          },
        ],
      }),
      repairDeps: () => ({}) as never,
      queued: () => ({
        engine: [],
        traktor: [
          {
            from: ['Macintosh HD', '/:m/:', 'uno.mp3'].join('\0'),
            patch: { cueShift: { shiftMs: -51.18 } },
          },
        ],
      }),
    })
    const scan = (await handlerFor('damage:scan')({ sender: {} }, [MP3])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBe(true)
  })
})

// Pending must survive a scan of another folder, a library that could not be read and a
// restart: only the queue that holds the repair knows it has not landed.
describe('damage:scan pending state', () => {
  const ENGINE_REPAIR = {
    target: 'engine' as const,
    path: '/m/e.wav',
    fileBytes: 1,
    expectTrackData: { sampleRate: 48000, sampleCount: 480000 },
    trimmedMs: 0,
  }

  const scanDeps = (found: boolean) => ({
    isAllowed: () => true,
    readGenre: async () => null,
    libraryGenres: async () => ({}),
    engine: async () =>
      found
        ? [
            {
              path: '/m/e.wav',
              judgement: {
                kind: 'engine-cues' as const,
                certainty: 'sure' as const,
                trimmedMs: 0,
                sampleRateHz: 44100,
              },
              fileBytes: 1,
              length: 10,
              trackData: ENGINE_REPAIR.expectTrackData,
            },
          ]
        : [],
  })

  it('keeps a finding pending through a scan that did not reach it', async () => {
    let found = false
    registerDamageIpc({
      scanDeps: () => scanDeps(found),
      repairDeps: () => ({}) as never,
      queued: () => ({
        engine: [
          { from: '/m/e.wav', to: '/m/e.wav', expectTrackData: ENGINE_REPAIR.expectTrackData },
        ],
        traktor: [],
      }),
    })
    await handlerFor('damage:scan')({ sender: {} }, ['/m/other.wav'])
    found = true
    const scan = (await handlerFor('damage:scan')({ sender: {} }, ['/m/e.wav'])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBe(true)
  })

  it('reads pending from the queue that holds the repair, after a restart too', async () => {
    registerDamageIpc({
      scanDeps: () => scanDeps(true),
      repairDeps: () => ({}) as never,
      queued: () => ({
        engine: [
          { from: '/m/e.wav', to: '/m/e.wav', expectTrackData: ENGINE_REPAIR.expectTrackData },
        ],
        traktor: [],
      }),
    })
    const scan = (await handlerFor('damage:scan')({ sender: {} }, ['/m/e.wav'])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBe(true)
  })

  it('is no longer pending once the queue let the repair go', async () => {
    registerDamageIpc({
      scanDeps: () => scanDeps(true),
      repairDeps: () => ({}) as never,
      queued: () => ({ engine: [], traktor: [] }),
    })
    const scan = (await handlerFor('damage:scan')({ sender: {} }, ['/m/e.wav'])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBeUndefined()
  })
})
