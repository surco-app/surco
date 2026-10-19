import { describe, expect, it } from 'vitest'
import { editResultOfOutcome } from './rekordboxQueueOps'

describe('editResultOfOutcome', () => {
  it('answers an applied outcome with what it created', () => {
    expect(editResultOfOutcome({ id: 'e', applied: true, createdId: '77', notices: [] })).toEqual({
      applied: true,
      createdId: '77',
    })
  })

  it('answers an add with its report', () => {
    const report = { added: 1, already: 0, notInCollection: 0, ambiguous: 0 }
    expect(editResultOfOutcome({ id: 'e', applied: true, report, notices: [] })).toEqual({
      applied: true,
      report,
    })
  })

  it('answers a refused outcome with its reason', () => {
    expect(editResultOfOutcome({ id: 'e', applied: false, reason: 'stale', notices: [] })).toEqual({
      applied: false,
      reason: 'stale',
    })
  })

  it('answers write-failed when the outcome has no reason or is missing', () => {
    expect(editResultOfOutcome({ id: 'e', applied: false, notices: [] })).toEqual({
      applied: false,
      reason: 'write-failed',
    })
    expect(editResultOfOutcome(undefined)).toEqual({ applied: false, reason: 'write-failed' })
  })
})
