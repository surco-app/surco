import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bumpUsage,
  canConvert,
  canUseFeature,
  type Entitlement,
  FREE_MONTHLY_CONVERSIONS,
  type LicenseState,
  remainingConversions,
  resolveEntitlement,
} from './license'

// A fixed mid-month, mid-day instant so monthKey() lands on the same month
// regardless of the machine's timezone.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime() // 2026-06
const FREE: Entitlement = { tier: 'free', isPro: false }
const PRO: Entitlement = { tier: 'pro', isPro: true }

describe('monthly free-tier metering', () => {
  it('starts the month with the full free allowance', () => {
    expect(remainingConversions(FREE, undefined, NOW)).toBe(FREE_MONTHLY_CONVERSIONS)
  })

  // Last month's count must not eat into this month's allowance — the limit is a
  // monthly reset, not a lifetime cap, so a stale tally is simply ignored.
  it('ignores a tally from a previous month', () => {
    expect(remainingConversions(FREE, { month: '2026-05', conversions: 9 }, NOW)).toBe(
      FREE_MONTHLY_CONVERSIONS,
    )
  })

  it('blocks the free tier once the monthly allowance is spent', () => {
    const spent = { month: '2026-06', conversions: FREE_MONTHLY_CONVERSIONS }
    expect(canConvert(FREE, spent, NOW)).toBe(false)
  })

  it('never limits Pro', () => {
    const spent = { month: '2026-06', conversions: 9999 }
    expect(remainingConversions(PRO, spent, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(canConvert(PRO, spent, NOW)).toBe(true)
  })
})

describe('bumpUsage', () => {
  it('increments within the same month', () => {
    expect(bumpUsage({ month: '2026-06', conversions: 2 }, NOW)).toEqual({
      month: '2026-06',
      conversions: 3,
    })
  })

  it('rolls over to a fresh count in a new month', () => {
    expect(bumpUsage({ month: '2026-05', conversions: 8 }, NOW)).toEqual({
      month: '2026-06',
      conversions: 1,
    })
  })

  it('starts at one with no prior usage', () => {
    expect(bumpUsage(undefined, NOW)).toEqual({ month: '2026-06', conversions: 1 })
  })
})

describe('Pro feature gates', () => {
  it('locks Pro features for free and unlocks them for Pro', () => {
    expect(canUseFeature(FREE, 'batch')).toBe(false)
    expect(canUseFeature(FREE, 'export')).toBe(false)
    expect(canUseFeature(PRO, 'batch')).toBe(true)
    expect(canUseFeature(PRO, 'export')).toBe(true)
  })
})

describe('resolveEntitlement while the beta flag is on (default)', () => {
  it('treats everyone as Pro so nothing is limited during the beta', () => {
    expect(resolveEntitlement(undefined, NOW)).toEqual({ tier: 'pro', isPro: true })
  })
})

// The real licensing rules only apply once the beta ends. Re-import the module with
// SURCO_BETA=0 so BETA_MODE is false, then exercise each path that decides Pro.
describe('resolveEntitlement after the beta (SURCO_BETA=0)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function load() {
    vi.stubEnv('SURCO_BETA', '0')
    vi.resetModules()
    return import('./license')
  }

  const active = (over: Partial<LicenseState> = {}): LicenseState => ({
    key: 'SURCO-XXXX',
    email: 'a@b.c',
    tier: 'pro',
    status: 'active',
    lastValidatedAt: NOW,
    ...over,
  })

  it('grants Pro for an active license validated within the grace window', async () => {
    const m = await load()
    expect(m.resolveEntitlement(active(), NOW).isPro).toBe(true)
  })

  it('falls back to free with no license', async () => {
    const m = await load()
    expect(m.resolveEntitlement(undefined, NOW).isPro).toBe(false)
  })

  it('falls back to free for an invalid (refunded/revoked) key', async () => {
    const m = await load()
    expect(m.resolveEntitlement(active({ status: 'invalid' }), NOW).isPro).toBe(false)
  })

  // A long-disconnected machine must eventually re-check in: past the grace window a
  // still-"active" cached license stops granting Pro until the server confirms it.
  it('falls back to free once validation is older than the offline grace window', async () => {
    const m = await load()
    const stale = active({ lastValidatedAt: NOW - m.OFFLINE_GRACE_MS - 1 })
    expect(m.resolveEntitlement(stale, NOW).isPro).toBe(false)
  })
})
