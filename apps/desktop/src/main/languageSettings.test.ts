import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-language-settings-'))
  return { app: { getPath: () => dir } }
})

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Settings } from '../shared/types'
import { getSettings, replaceSettings, saveSettings } from './settings'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

describe('language preference validation', () => {
  it('falls back to system for an invalid language in an old settings file', () => {
    const path = join(app.getPath('userData'), 'settings.json')
    writeFileSync(path, JSON.stringify({ language: 'ko' }))

    expect(getSettings().language).toBe('system')
  })

  it('validates renderer saves and imported settings', () => {
    expect(saveSettings({ language: 'ja' }).language).toBe('ja')
    expect(saveSettings({ language: 'not-a-locale' as Settings['language'] }).language).toBe(
      'system',
    )
    expect(replaceSettings({ language: 'not-a-locale' as Settings['language'] }).language).toBe(
      'system',
    )

    const persisted = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8'),
    ) as Settings
    expect(persisted.language).toBe('system')
  })
})
