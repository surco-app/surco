import { afterAll, describe, expect, it, vi } from 'vitest'

// settings.ts persists to app.getPath('userData')/settings.json, so point Electron
// at a throwaway temp dir and exercise the real read/merge/write round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-settings-'))
  return { app: { getPath: () => dir } }
})

import { app } from 'electron'
import { rmSync } from 'node:fs'
import { getSettings, recordConversion } from './settings'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

describe('recordConversion', () => {
  // The Stats tab is only as honest as this counter: each completed conversion
  // must bump the persisted total by exactly one and survive a reload.
  it('increments the persisted conversion count by one each time', () => {
    expect(getSettings().conversionCount).toBe(0)
    recordConversion()
    recordConversion()
    expect(getSettings().conversionCount).toBe(2)
  })
})
