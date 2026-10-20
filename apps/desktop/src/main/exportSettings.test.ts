import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'surco-export-'))
})

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { rmSync } from 'node:fs'
import { activeCueFlow, CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../shared/cueFlows'
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
      markPoint: true,
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

  it('keeps the Mi flujo of a settings file exported by an earlier Surco, as the active flow', () => {
    const mine: CueFlow = { ...MY_FLOW, rules: [{ ...MY_FLOW.rules[0], bars: 8 }] }
    saveSettings({ cueFlows: [ONE_AT_32], activeCueFlow: 'one-at-32' })
    const back = applyImportedSettings({
      cueFlows: [mine, ONE_AT_32, CALLS_ONLY],
      activeCueFlow: 'mine',
    })
    expect(back.cueFlows).toEqual([mine, ONE_AT_32, CALLS_ONLY])
    expect(activeCueFlow(back)).toEqual(mine)
  })

  it('brings back Mi flujo for an earlier export that has it active without the flows', () => {
    const back = applyImportedSettings({ activeCueFlow: 'mine' })
    expect(back.cueFlows).toEqual([ONE_AT_32, MY_FLOW])
    expect(activeCueFlow(back)).toEqual(MY_FLOW)
  })
})
