import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readJson, sql } from './_lib'

interface Body {
  key?: string
  deviceId?: string
}

// POST → re-checks a key + device (the app calls this on launch). Confirms the license
// is still active and this device is one of its activations, and bumps last_seen_at.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ valid: false, reason: 'method_not_allowed' })
    return
  }
  const { key, deviceId } = await readJson<Body>(req)
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

  const act = await sql`select id from activations where license_id = ${lic.id} and device_id = ${deviceId}`
  if (act.length === 0) {
    res.status(409).json({ valid: false, reason: 'not_activated' })
    return
  }
  await sql`update activations set last_seen_at = now() where id = ${act[0].id}`

  const used = await sql`select count(*)::int as n from activations where license_id = ${lic.id}`
  res.status(200).json({
    valid: true,
    tier: 'pro',
    activations: used[0].n,
    maxActivations: lic.max_activations,
  })
}
