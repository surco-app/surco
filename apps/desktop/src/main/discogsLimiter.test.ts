import { describe, expect, it } from 'vitest'
import { discogsLimiterFor } from './discogsLimiter'

describe('discogsLimiterFor', () => {
  // The shared app key's 60 req/min ceiling is split across every Surco user at once, so the
  // default path must stay conservative — a user's own token gets its own private 60/min
  // bucket and can be paced closer to the ceiling. Routing by token is what keeps one user's
  // faster sweep from spending the shared pool everyone else also draws from.
  it('gives a user token a different bucket than the shared app key', () => {
    const shared = discogsLimiterFor('')
    const user = discogsLimiterFor('my-user-token')
    expect(user).not.toBe(shared)
  })

  // The same token always maps to the same bucket, or two calls in one probe would pace
  // against separate buckets and collectively burst past the cap.
  it('routes every shared-key call through the one shared bucket', () => {
    expect(discogsLimiterFor('')).toBe(discogsLimiterFor(''))
  })

  it('routes every user-token call through the one user bucket', () => {
    expect(discogsLimiterFor('token-a')).toBe(discogsLimiterFor('token-b'))
  })
})
