import { hostname } from 'node:os'
import { app } from 'electron'
import log from 'electron-log/main'
import {
  BETA_MODE,
  type LicenseActionResult,
  type LicenseSnapshot,
  MAX_ACTIVATIONS,
  PRO_PRICE_EUR,
  remainingConversions,
  resolveEntitlement,
} from '../shared/license'
import { getSettings, saveSettings } from './settings'

// Where the desktop app talks to the Stripe/Neon-backed licensing API. Defaults to
// the production web app's serverless functions; override with SURCO_LICENSE_API
// (e.g. a Vercel preview URL) when testing against a non-production deployment.
const API_BASE = process.env.SURCO_LICENSE_API || 'https://getsurco.app'

// Server response shape, shared by /api/activate and /api/validate.
interface ServerResult {
  valid: boolean
  tier?: 'free' | 'pro'
  activations?: number
  maxActivations?: number
  reason?: string
}

async function post(path: string, body: unknown): Promise<ServerResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    // Both success and the 4xx licensing errors carry a JSON body; anything else
    // (5xx, HTML error page) is a transport problem the caller treats as offline.
    const data = (await res.json().catch(() => ({}))) as ServerResult
    if (res.ok) return { ...data, valid: true }
    return { ...data, valid: false, reason: data.reason || `http_${res.status}` }
  } finally {
    clearTimeout(timer)
  }
}

// Builds the renderer-facing snapshot from the persisted state. Infinity (Pro's
// unlimited allowance) can't cross JSON, so it's sent as null.
export function licenseSnapshot(): LicenseSnapshot {
  const s = getSettings()
  const now = Date.now()
  const entitlement = resolveEntitlement(s.license, now)
  const remaining = remainingConversions(entitlement, s.usage, now)
  return {
    betaMode: BETA_MODE,
    entitlement,
    key: s.license?.key ?? '',
    email: s.license?.email ?? '',
    status: s.license?.status ?? 'none',
    remainingConversions: Number.isFinite(remaining) ? remaining : null,
    freeMonthlyConversions: remainingConversions({ tier: 'free', isPro: false }, undefined, now),
    maxActivations: MAX_ACTIVATIONS,
    proPriceEur: PRO_PRICE_EUR,
  }
}

// Activates a key for this device. On success the license is cached locally so the
// app stays Pro offline (within the grace window); on a licensing rejection the
// key is recorded as invalid so the UI can explain why.
export async function activateLicense(key: string, email: string): Promise<LicenseActionResult> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, reason: 'empty', snapshot: licenseSnapshot() }
  const s = getSettings()
  let result: ServerResult
  try {
    result = await post('/api/activate', {
      key: trimmed,
      email: email.trim(),
      deviceId: s.deviceId,
      deviceName: hostname(),
      platform: process.platform,
      appVersion: app.getVersion(),
    })
  } catch (err) {
    log.error('license activate failed', err)
    return { ok: false, reason: 'offline', snapshot: licenseSnapshot() }
  }
  if (result.valid) {
    saveSettings({
      license: {
        key: trimmed,
        email: email.trim(),
        tier: result.tier ?? 'pro',
        status: 'active',
        lastValidatedAt: Date.now(),
      },
    })
    return { ok: true, snapshot: licenseSnapshot() }
  }
  saveSettings({
    license: {
      key: trimmed,
      email: email.trim(),
      tier: 'free',
      status: 'invalid',
      lastValidatedAt: 0,
    },
  })
  return { ok: false, reason: result.reason, snapshot: licenseSnapshot() }
}

// Re-checks the cached license with the server. A successful check refreshes the
// validation timestamp (resetting the offline grace window); a network failure is
// swallowed so a temporary outage doesn't downgrade a paying user.
export async function validateLicense(): Promise<LicenseActionResult> {
  const s = getSettings()
  if (!s.license?.key) return { ok: false, reason: 'none', snapshot: licenseSnapshot() }
  let result: ServerResult
  try {
    result = await post('/api/validate', { key: s.license.key, deviceId: s.deviceId })
  } catch (err) {
    log.error('license validate failed (kept cached state)', err)
    return { ok: false, reason: 'offline', snapshot: licenseSnapshot() }
  }
  if (result.valid) {
    saveSettings({
      license: {
        ...s.license,
        tier: result.tier ?? 'pro',
        status: 'active',
        lastValidatedAt: Date.now(),
      },
    })
    return { ok: true, snapshot: licenseSnapshot() }
  }
  // The server explicitly rejected the key (refunded/revoked/unknown): downgrade.
  saveSettings({ license: { ...s.license, tier: 'free', status: 'invalid' } })
  return { ok: false, reason: result.reason, snapshot: licenseSnapshot() }
}

// Frees this device's activation slot (so the user can move to another machine)
// and clears the local license regardless of whether the server call succeeds.
export async function deactivateLicense(): Promise<LicenseActionResult> {
  const s = getSettings()
  if (s.license?.key) {
    try {
      await post('/api/deactivate', { key: s.license.key, deviceId: s.deviceId })
    } catch (err) {
      log.error('license deactivate failed (cleared locally anyway)', err)
    }
  }
  saveSettings({ license: undefined })
  return { ok: true, snapshot: licenseSnapshot() }
}
