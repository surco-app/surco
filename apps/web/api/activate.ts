import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readJson, sql } from './_lib'

interface Body {
  key?: string
  email?: string
  deviceId?: string
  deviceName?: string
  platform?: string
  appVersion?: string
}

// POST → registers this device against a license, enforcing the per-license device
// cap. Re-activating the same device is idempotent (refreshes it, no new seat).
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ valid: false, reason: 'method_not_allowed' })
    return
  }
  const { key, deviceId, deviceName, platform, appVersion } = await readJson<Body>(req)
  if (!key || !deviceId) {
    res.status(400).json({ valid: false, reason: 'missing_fields' })
    return
  }

  const licenses = await sql`select * from licenses where license_key = ${key}`
  const lic = licenses[0]
  if (!lic) {
    res.status(404).json({ valid: false, reason: 'not_found' })
    return
  }
  if (lic.status !== 'active') {
    res.status(402).json({ valid: false, reason: lic.status })
    return
  }

  const already = await sql`select 1 from activations where license_id = ${lic.id} and device_id = ${deviceId}`
  if (already.length === 0) {
    const used = await sql`select count(*)::int as n from activations where license_id = ${lic.id}`
    if (used[0].n >= lic.max_activations) {
      res.status(409).json({ valid: false, reason: 'too_many_devices' })
      return
    }
    await sql`
      insert into activations (license_id, device_id, device_name, platform, app_version)
      values (${lic.id}, ${deviceId}, ${deviceName ?? null}, ${platform ?? null}, ${appVersion ?? null})
    `
  } else {
    await sql`
      update activations set last_seen_at = now(), device_name = ${deviceName ?? null}, app_version = ${appVersion ?? null}
      where license_id = ${lic.id} and device_id = ${deviceId}
    `
  }

  const used = await sql`select count(*)::int as n from activations where license_id = ${lic.id}`
  res.status(200).json({
    valid: true,
    tier: 'pro',
    activations: used[0].n,
    maxActivations: lic.max_activations,
  })
}
