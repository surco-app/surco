import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readJson, sql } from './_lib'

interface Body {
  key?: string
  deviceId?: string
}

// POST → frees this device's seat so the license can be moved to another machine.
// Idempotent: deleting a non-existent activation is a no-op and still returns ok.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false })
    return
  }
  const { key, deviceId } = await readJson<Body>(req)
  if (key && deviceId) {
    const licenses = await sql`select id from licenses where license_key = ${key}`
    if (licenses[0]) {
      await sql`delete from activations where license_id = ${licenses[0].id} and device_id = ${deviceId}`
    }
  }
  res.status(200).json({ ok: true })
}
