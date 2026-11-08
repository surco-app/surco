import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-import-'))
  return { app: { getPath: () => dir } }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it("importing a backup keeps this machine's Beatport account", () => {
    saveSettings({ beatportUsername: 'dj', beatportPassword: 'ENCRYPTED' })
    applyImportedSettings({ theme: 'dark', beatportUsername: 'other', beatportPassword: 'OTHER' })
    expect(getSettings().beatportUsername).toBe('dj')
    expect(getSettings().beatportPassword).toBe('ENCRYPTED')
  })

  it("keeps this machine's own paths when the backup's folders don't exist here", () => {
    saveSettings({
      outputDir: '/aqui/salida',
      engineLibraryDir: '/aqui/engine',
      traktorNmlPath: '/aqui/collection.nml',
      rekordboxDbPath: '/aqui/master.db',
    })
    applyImportedSettings({
      theme: 'dark',
      outputDir: '/otro-mac/salida',
      engineLibraryDir: '/otro-mac/engine',
      traktorNmlPath: '/otro-mac/collection.nml',
      rekordboxDbPath: '/otro-mac/master.db',
    })
    const s = getSettings()
    expect(s.outputDir).toBe('/aqui/salida')
    expect(s.engineLibraryDir).toBe('/aqui/engine')
    expect(s.traktorNmlPath).toBe('/aqui/collection.nml')
    expect(s.rekordboxDbPath).toBe('/aqui/master.db')
  })

  it('adopts the backup path when that folder exists here', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-out-'))
    saveSettings({ outputDir: '/aqui/salida' })
    applyImportedSettings({ theme: 'dark', outputDir: dir })
    expect(getSettings().outputDir).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it('adopts a backup folder that does not exist yet while the folder holding it does', () => {
    const parent = mkdtempSync(join(tmpdir(), 'surco-parent-'))
    const toCreate = join(parent, 'Surco')
    saveSettings({ outputDir: '/aqui/salida' })
    applyImportedSettings({ theme: 'dark', outputDir: toCreate })
    expect(getSettings().outputDir).toBe(toCreate)
    rmSync(parent, { recursive: true, force: true })
  })

  it("keeps this machine's paths when the backup does not mention them", () => {
    saveSettings({ engineLibraryDir: '/aqui/engine', traktorNmlPath: '/aqui/collection.nml' })
    applyImportedSettings({ theme: 'dark' })
    expect(getSettings().engineLibraryDir).toBe('/aqui/engine')
    expect(getSettings().traktorNmlPath).toBe('/aqui/collection.nml')
  })

  it("keeps this machine's path when the backup holds an empty one", () => {
    saveSettings({ rekordboxDbPath: '/aqui/master.db' })
    applyImportedSettings({ theme: 'dark', rekordboxDbPath: '' })
    expect(getSettings().rekordboxDbPath).toBe('/aqui/master.db')
  })
})
