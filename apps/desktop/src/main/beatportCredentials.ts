import { safeStorage } from 'electron'
import { errorWithKey } from '../shared/errorKeys'
import type { Settings } from '../shared/types'
import { type BeatportCredentials, createBeatportSession } from './beatportSession'
import { getSettings, saveSettings } from './settings'

export function storedBeatportCredentials(): BeatportCredentials | null {
  const { beatportUsername, beatportPassword } = getSettings()
  if (!beatportUsername || !beatportPassword || !safeStorage.isEncryptionAvailable()) return null
  try {
    return {
      username: beatportUsername,
      password: safeStorage.decryptString(Buffer.from(beatportPassword, 'base64')),
    }
  } catch {
    return null
  }
}

export const beatportSession = createBeatportSession({
  fetch: (...args) => fetch(...args),
  credentials: storedBeatportCredentials,
  now: Date.now,
})

export async function connectBeatport(username: string, password: string): Promise<Settings> {
  if (!safeStorage.isEncryptionAvailable()) throw errorWithKey('beatportNoSecureStorage')
  const credentials = { username: username.trim(), password }
  await beatportSession.validate(credentials)
  const next = saveSettings({
    beatportUsername: credentials.username,
    beatportPassword: safeStorage.encryptString(password).toString('base64'),
  })
  beatportSession.reset()
  return next
}

export function disconnectBeatport(): Settings {
  beatportSession.reset()
  return saveSettings({ beatportUsername: '', beatportPassword: '' })
}
