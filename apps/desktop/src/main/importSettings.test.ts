import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-import-'))
  return { app: { getPath: () => dir } }
})

import { rmSync } from 'node:fs'
import { app } from 'electron'
import { applyImportedSettings } from './exportIpc'
import { getSettings, saveSettings } from './settings'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

describe('applyImportedSettings', () => {
  // Restaurar un backup debe dejar la config EXACTAMENTE como el backup, no fusionada
  // con lo que había — es "reemplazar todo". Pero un backup de una versión vieja de
  // Surco no tendrá campos nuevos: esos se rellenan con defaults, no se rompen.
  it('replaces current settings and fills missing keys from defaults', () => {
    saveSettings({ theme: 'light', discogsToken: 'old' })
    const restored = applyImportedSettings({ theme: 'dark' })
    expect(restored.theme).toBe('dark')
    expect(restored.discogsToken).toBe('')
    expect(restored.mp3Quality).toBeDefined()
    expect(getSettings().theme).toBe('dark')
  })

  // Un JSON ajeno (o corrupto) elegido por error NO debe aplicarse: reemplazar-todo
  // es destructivo, así que sin al menos una clave conocida de Surco, se rechaza.
  it('throws on an object with no known Surco settings keys', () => {
    expect(() => applyImportedSettings({ foo: 1, bar: 2 })).toThrow()
    expect(() => applyImportedSettings('not an object')).toThrow()
    expect(() => applyImportedSettings(null)).toThrow()
  })
})
