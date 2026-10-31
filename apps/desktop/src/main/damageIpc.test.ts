import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { isPackaged: false } }))

import { ipcMain } from 'electron'
import { pendingDamage, registerDamageIpc } from './damageIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as never
}

const MP3 = '/m/uno.mp3'

beforeEach(() => {
  vi.clearAllMocks()
  pendingDamage.clear()
})

// A repair held while Traktor or Engine DJ stays open lands later. Until it does, the scan
// still finds the damage, and staging it again would queue the same shift twice.
describe('damage:scan', () => {
  it('marks a finding whose repair is still queued, and keeps one this scan did not reach', async () => {
    registerDamageIpc({
      scanDeps: () => ({
        isAllowed: () => true,
        readGenre: async () => ({ raw: '(35) Deep House' }),
        libraryGenres: async () => ({}),
      }),
      repairDeps: () => ({}) as never,
    })
    pendingDamage.add(`genre-number\0${MP3}`)
    pendingDamage.add('engine-cues\0/m/gone.wav')
    const scan = (await handlerFor('damage:scan')({ sender: {} }, [MP3])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBe(true)
    expect(pendingDamage.has('engine-cues\0/m/gone.wav')).toBe(true)
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
  const engineFinding = {
    id: 'engine-cues\0/m/e.wav',
    kind: 'engine-cues' as const,
    path: '/m/e.wav',
    certainty: 'sure' as const,
    evidence: [],
    before: { key: 'x' },
    options: [],
    repair: ENGINE_REPAIR,
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

  it('keeps a pending id through a scan that did not find it', async () => {
    let found = false
    registerDamageIpc({ scanDeps: () => scanDeps(found), repairDeps: () => ({}) as never })
    pendingDamage.add(engineFinding.id)
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
    pendingDamage.add(engineFinding.id)
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
