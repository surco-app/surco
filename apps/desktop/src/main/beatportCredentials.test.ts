import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { dir, encryption } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return {
    dir: mkdtempSync(join(tmpdir(), 'surco-beatport-creds-')) as string,
    encryption: { available: true },
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().slice(4),
  },
}))

import { rmSync } from 'node:fs'
import { errorKeyOf, errorWithKey } from '../shared/errorKeys'
import {
  beatportSession,
  connectBeatport,
  disconnectBeatport,
  storedBeatportCredentials,
} from './beatportCredentials'
import { getSettings, saveSettings } from './settings'

async function keyOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return errorKeyOf((err as Error).message)
  }
  return 'resolved'
}

afterAll(() => rmSync(dir, { recursive: true, force: true }))

beforeEach(() => {
  encryption.available = true
  saveSettings({ beatportUsername: '', beatportPassword: '' })
  vi.restoreAllMocks()
  vi.spyOn(beatportSession, 'validate').mockImplementation(async ({ password }) => {
    if (password !== 'p') throw errorWithKey('beatportBadCredentials')
  })
})

describe('Beatport credentials', () => {
  it('stores the password encrypted, never as typed', async () => {
    await connectBeatport('u', 'p')
    const { beatportUsername, beatportPassword } = getSettings()
    expect(beatportUsername).toBe('u')
    expect(beatportPassword).not.toBe('p')
    expect(Buffer.from(beatportPassword, 'base64').toString()).toBe('enc:p')
  })

  it('wrong credentials store nothing', async () => {
    expect(await keyOf(connectBeatport('u', 'wrong'))).toBe('beatportBadCredentials')
    expect(getSettings().beatportUsername).toBe('')
    expect(getSettings().beatportPassword).toBe('')
  })

  it('refuses to store when the OS cannot encrypt', async () => {
    encryption.available = false
    expect(await keyOf(connectBeatport('u', 'p'))).toBe('beatportNoSecureStorage')
    expect(beatportSession.validate).not.toHaveBeenCalled()
    expect(getSettings().beatportPassword).toBe('')
  })

  it('reads back the stored account for the session', async () => {
    expect(storedBeatportCredentials()).toBeNull()
    await connectBeatport('u', 'p')
    expect(storedBeatportCredentials()).toEqual({ username: 'u', password: 'p' })
  })

  it('disconnect wipes both keys and the live session', async () => {
    await connectBeatport('u', 'p')
    const reset = vi.spyOn(beatportSession, 'reset')
    disconnectBeatport()
    expect(getSettings().beatportUsername).toBe('')
    expect(getSettings().beatportPassword).toBe('')
    expect(reset).toHaveBeenCalled()
  })
})
