import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { beginNmlBatch, endNmlBatch, recordNmlPatch } from './nmlBatch'
import { beginRekordboxBatch, endRekordboxBatch, recordRekordboxRepoint } from './rekordboxBatch'
import type { VerifyEntry } from './verifyRegistry'
import { withRecordedRun } from './verifyRun'

afterEach(() => {
  endNmlBatch()
  endRekordboxBatch()
})

describe('withRecordedRun', () => {
  // The app and the scenario harness both hand the registry a conversion through this one
  // function: each built its own copy, and the harness copy dropped the names and sizes,
  // so the matrix judged a verifier that never knew what to expect.
  it('hands the registry everything the run recorded for the converted file', () => {
    beginNmlBatch()
    beginRekordboxBatch()
    recordNmlPatch(
      { volume: 'HD', dir: '/:M:/', file: 'a.mp3' },
      { input: '/m/a.mp3', output: '/m/b.mp3' },
    )
    recordRekordboxRepoint({
      from: '/m/a.mp3',
      to: '/m/b.mp3',
      audio: { cueShiftMs: 12 },
      engineShift: { trimmedMs: 5 },
      fromBytes: 100,
      names: { title: { from: 'Old', to: 'New' } },
    })

    const entry = withRecordedRun({ source: '/m/a.mp3', to: '/m/b.mp3' } as VerifyEntry)

    expect(entry).toMatchObject({
      traktorPatch: { file: 'a.mp3' },
      cueShiftMs: 12,
      engineShift: { trimmedMs: 5 },
      fromBytes: 100,
      names: { title: { from: 'Old', to: 'New' } },
    })
  })
})
