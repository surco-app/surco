import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'surco-export-'))
})

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { rmSync } from 'node:fs'
import type { CueFlow } from '../shared/cueFlows'
import { applyImportedSettings, serializeSettingsForExport } from './exportIpc'
import { getSettings, saveSettings } from './settings'

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

  it('an export never carries the Beatport account, which only decrypts on this machine', () => {
    saveSettings({ beatportUsername: 'dj', beatportPassword: 'ENCRYPTED' })
    const parsed = JSON.parse(serializeSettingsForExport())
    expect(parsed).not.toHaveProperty('beatportUsername')
    expect(parsed).not.toHaveProperty('beatportPassword')
  })

  it('carries a flow the DJ built to another install and back', () => {
    const flow: CueFlow = {
      id: 'x',
      name: 'Una a 64',
      rules: [
        {
          from: 'drop',
          direction: 'back',
          bars: 64,
          repeat: 1,
          when: 'fits',
          place: 'hot',
          color: { fixed: 42 },
        },
      ],
    }
    saveSettings({ cueFlows: [...getSettings().cueFlows, flow], activeCueFlow: 'x' })
    const exported = JSON.parse(serializeSettingsForExport())
    saveSettings({ cueFlows: [], activeCueFlow: 'mine' })
    const back = applyImportedSettings(exported)
    expect(back.cueFlows.find((f) => f.id === 'x')).toEqual(flow)
    expect(back.activeCueFlow).toBe('x')
  })
})
