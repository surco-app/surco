import { afterAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

// session.ts persists to app.getPath('userData')/session.json; point Electron at a
// throwaway temp dir and exercise the real save/load round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-session-'))
  return { app: { getPath: () => dir } }
})

import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { loadLastSession, saveLastSession } from './session'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

describe('session store', () => {
  // The whole point of the store: what the user had loaded comes back after a relaunch.
  // Only files that still exist are offered — a track deleted since would import as a
  // broken row, so a stale path must silently drop out of the offer.
  it('round-trips the saved paths, dropping files that no longer exist', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept, join(dir, 'gone.wav')])
    expect(loadLastSession()).toEqual([kept])
  })

  // Clearing the list is a deliberate start-over; the next launch must not offer the
  // session the user just emptied.
  it('persists an emptied session', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    saveLastSession([kept])
    saveLastSession([])
    expect(loadLastSession()).toEqual([])
  })

  // A corrupt or hand-edited file must degrade to "no previous session", never crash
  // the launch path that reads it.
  it('treats a corrupt or malformed session file as empty', () => {
    const file = join(app.getPath('userData'), 'session.json')
    writeFileSync(file, '{not json')
    expect(loadLastSession()).toEqual([])
    writeFileSync(file, JSON.stringify({ paths: 'nope' }))
    expect(loadLastSession()).toEqual([])
    writeFileSync(file, JSON.stringify({ paths: [1, 2] }))
    expect(loadLastSession()).toEqual([])
  })
})
