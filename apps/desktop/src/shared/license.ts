// Freemium configuration and the pure entitlement/metering logic that the rest of
// the app builds on. Everything here is side-effect free so it can be unit-tested
// and shared verbatim between the main process (enforcement) and the renderer (UI).

// The master switch. While BETA_MODE is on, every user is treated as Pro: no usage
// limit and no Pro-only gate is ever enforced. The whole monetization system is
// fully built and wired, just dormant. Flip this to false — or set SURCO_BETA=0 in
// the environment — to end the beta and turn Surco into a real freemium app: the
// free-tier limits and Pro features below start applying immediately.
const betaDisabled = typeof process !== 'undefined' && process.env?.SURCO_BETA === '0'
export const BETA_MODE: boolean = !betaDisabled

export type Tier = 'free' | 'pro'

// Free-tier ceiling on track conversions, counted per calendar month. Single source
// of truth so the number enforced by the meter always matches the number shown in
// the upgrade copy.
export const FREE_MONTHLY_CONVERSIONS = 10

// How many devices one Pro license may have active at the same time.
export const MAX_ACTIVATIONS = 3

// One-time Pro price in euros. Kept here as the single source the desktop upgrade
// screen reads; the web checkout reads its mirror in apps/web/src/config.ts.
export const PRO_PRICE_EUR = 29

// Features that require Pro once the beta ends. 'batch' is the "Convert all" run;
// 'export' is exporting a crate to rekordbox/Traktor.
export type ProFeature = 'batch' | 'export'

// A validated license can keep working offline for this long before the app falls
// back to the free tier and asks to re-validate. Covers normal disconnected use
// (flights, studios) without letting a refunded/revoked key run forever.
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000

// What the app persists about the user's license. Absent/empty key means free tier.
export interface LicenseState {
  // The license key as entered by the user; '' when none is activated.
  key: string
  // The email the license was bought with, echoed back for display and recovery.
  email: string
  // Last tier the server reported for this key.
  tier: Tier
  // Last status the server reported. 'none' before any activation; 'invalid' when
  // the server rejected the key (unknown, refunded, revoked, too many devices).
  status: 'none' | 'active' | 'invalid'
  // Epoch ms of the last successful server validation, for the offline grace window.
  lastValidatedAt: number
}

// Per-month usage tally for the free tier. Reset implicitly by comparing months.
export interface UsageState {
  // Calendar month this tally belongs to, as 'YYYY-MM'.
  month: string
  // Conversions completed during `month`.
  conversions: number
}

export interface Entitlement {
  tier: Tier
  isPro: boolean
}

// The renderer-facing view of licensing state, built in the main process and sent
// over IPC. `remainingConversions` is null when unlimited (Pro/beta), since JSON
// can't carry Infinity.
export interface LicenseSnapshot {
  betaMode: boolean
  entitlement: Entitlement
  key: string
  email: string
  status: LicenseState['status']
  remainingConversions: number | null
  freeMonthlyConversions: number
  maxActivations: number
  proPriceEur: number
}

// What activate/validate/deactivate return to the renderer: whether the action
// succeeded, an optional machine-readable reason on failure, and the refreshed
// snapshot to render from.
export interface LicenseActionResult {
  ok: boolean
  reason?: string
  snapshot: LicenseSnapshot
}

export function monthKey(now: number): string {
  const d = new Date(now)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}`
}

// Resolves what the user is entitled to right now. BETA_MODE wins over everything;
// otherwise a Pro entitlement requires an active 'pro' license validated within the
// offline grace window.
export function resolveEntitlement(license: LicenseState | undefined, now: number): Entitlement {
  if (BETA_MODE) return { tier: 'pro', isPro: true }
  if (license?.status !== 'active' || license.tier !== 'pro') {
    return { tier: 'free', isPro: false }
  }
  if (now - license.lastValidatedAt > OFFLINE_GRACE_MS) {
    return { tier: 'free', isPro: false }
  }
  return { tier: 'pro', isPro: true }
}

// Conversions still allowed this month on the free tier. Pro is effectively
// unlimited (returns Infinity) so callers can treat the number uniformly.
export function remainingConversions(
  entitlement: Entitlement,
  usage: UsageState | undefined,
  now: number,
): number {
  if (entitlement.isPro) return Number.POSITIVE_INFINITY
  const used = usage && usage.month === monthKey(now) ? usage.conversions : 0
  return Math.max(0, FREE_MONTHLY_CONVERSIONS - used)
}

export function canConvert(
  entitlement: Entitlement,
  usage: UsageState | undefined,
  now: number,
): boolean {
  return remainingConversions(entitlement, usage, now) > 0
}

// Pro-only features are simply unlocked by a Pro entitlement; kept as a function so
// callers read the same way as canConvert and the rule has one home.
export function canUseFeature(entitlement: Entitlement, _feature: ProFeature): boolean {
  return entitlement.isPro
}

// Folds one completed conversion into the monthly tally, rolling over to a fresh
// count when the month changes.
export function bumpUsage(usage: UsageState | undefined, now: number): UsageState {
  const month = monthKey(now)
  const conversions = usage && usage.month === month ? usage.conversions + 1 : 1
  return { month, conversions }
}
