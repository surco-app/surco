import { afterEach, describe, expect, it } from 'vitest'
import type { Verification } from '../../../shared/verification'
import {
  bufferDroppedVerification,
  clearDroppedVerifications,
  settleVerification,
} from './verificationBuffer'

const v = (job: string, seq: number): Verification => ({ status: 'checking', checks: [], job, seq })

afterEach(() => clearDroppedVerifications())

describe('settleVerification', () => {
  // The check of this conversion may report before the conversion's own result lands.
  it('replays a buffered update of the result job that is newer than the result', () => {
    bufferDroppedVerification('a', v('j2', 1))
    expect(settleVerification('a', v('j2', 0), v('j1', 4))).toEqual(v('j2', 1))
  })

  it('ignores a buffered update of an older job', () => {
    bufferDroppedVerification('a', v('j1', 5))
    expect(settleVerification('a', v('j2', 0), v('j1', 4))).toEqual(v('j2', 0))
  })

  it('ignores a buffered update of the same job that is not newer', () => {
    bufferDroppedVerification('a', v('j2', 0))
    expect(settleVerification('a', v('j2', 0), undefined)).toEqual(v('j2', 0))
  })

  it('keeps a newer update the live row already holds', () => {
    expect(settleVerification('a', v('j2', 0), v('j2', 3))).toEqual(v('j2', 3))
  })

  it('keeps the newest of the buffered updates of one job', () => {
    bufferDroppedVerification('a', v('j2', 2))
    bufferDroppedVerification('a', v('j2', 1))
    expect(settleVerification('a', v('j2', 0), undefined)).toEqual(v('j2', 2))
  })

  it('forgets the buffer once settled', () => {
    bufferDroppedVerification('a', v('j2', 1))
    settleVerification('a', v('j2', 0), undefined)
    expect(settleVerification('a', v('j2', 0), undefined)).toEqual(v('j2', 0))
  })
})

describe('bufferDroppedVerification', () => {
  it('a stale update arriving after the new job report does not displace it', () => {
    bufferDroppedVerification('a', v('j2', 1))
    bufferDroppedVerification('a', v('j0', 9))
    expect(settleVerification('a', v('j2', 0), undefined)).toEqual(v('j2', 1))
  })
})
