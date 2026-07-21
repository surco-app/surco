import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'surco-export-'))
})

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { rmSync } from 'node:fs'
import { serializeSettingsForExport } from './exportIpc'
import { saveSettings } from './settings'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serializeSettingsForExport', () => {
  // Un backup solo sirve si lo lleva TODO. El token es el caso frontera: está fuera
  // del fichero sincronizado a propósito, así que el export tiene que incluirlo
  // explícitamente o el "backup completo" no restauraría el acceso a Discogs.
  it('includes the full settings object, token included', () => {
    saveSettings({ discogsToken: 'secret-token', theme: 'dark' })
    const json = serializeSettingsForExport()
    const parsed = JSON.parse(json)
    expect(parsed.discogsToken).toBe('secret-token')
    expect(parsed.theme).toBe('dark')
    expect(parsed.stats).toBeDefined()
  })
})
