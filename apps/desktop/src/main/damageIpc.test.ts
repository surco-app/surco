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
  it('marks a finding whose repair is still queued, and forgets one no longer found', async () => {
    registerDamageIpc({
      scanDeps: () => ({
        isAllowed: () => true,
        readGenre: async () => ({ raw: '(35) Deep House' }),
        libraryGenres: async () => ({}),
      }),
    })
    pendingDamage.add(`genre-number\0${MP3}`)
    pendingDamage.add('engine-cues\0/m/gone.wav')
    const scan = (await handlerFor('damage:scan')({ sender: {} }, [MP3])) as {
      findings: { pending?: true }[]
    }
    expect(scan.findings[0].pending).toBe(true)
    expect([...pendingDamage]).toEqual([`genre-number\0${MP3}`])
  })
})
