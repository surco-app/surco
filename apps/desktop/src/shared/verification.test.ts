import { describe, expect, it } from 'vitest'
import {
  type CheckState,
  PLACE_ORDER,
  type PlaceCheck,
  type VerifyPlace,
  verificationStatus,
  withChecks,
} from './verification'

const check = (place: VerifyPlace, state: CheckState): PlaceCheck => ({
  place,
  state,
  detail: { key: `verify.${place}.${state}` },
})

describe('verificationStatus', () => {
  it('all ok is ok', () => {
    expect(verificationStatus([check('file', 'ok'), check('appleMusic', 'ok')])).toBe('ok')
  })

  it('a mismatch wins over a check still running', () => {
    expect(verificationStatus([check('file', 'mismatch'), check('appleMusic', 'checking')])).toBe(
      'mismatch',
    )
  })

  it('unreadable reads as mismatch', () => {
    expect(verificationStatus([check('file', 'ok'), check('traktor', 'unreadable')])).toBe(
      'mismatch',
    )
  })

  it('checking wins over pending', () => {
    expect(verificationStatus([check('rekordbox', 'pending'), check('file', 'checking')])).toBe(
      'checking',
    )
  })

  it('pending is not ok', () => {
    expect(verificationStatus([check('file', 'ok'), check('rekordbox', 'pending')])).toBe('pending')
  })

  it('nothing checked yet is checking, never ok', () => {
    expect(verificationStatus([])).toBe('checking')
  })

  it('withChecks replaces one place and keeps the rest in place order', () => {
    const start = {
      status: 'checking' as const,
      checks: [check('file', 'ok'), check('rekordbox', 'checking'), check('traktor', 'ok')],
    }
    const next = withChecks(start, [check('rekordbox', 'mismatch'), check('appleMusic', 'ok')])
    expect(next.checks.map((c) => c.place)).toEqual(PLACE_ORDER.filter((p) => p !== 'engine'))
    expect(next.checks.find((c) => c.place === 'rekordbox')?.state).toBe('mismatch')
    expect(next.checks.find((c) => c.place === 'file')?.state).toBe('ok')
    expect(next.status).toBe('mismatch')
  })
})
