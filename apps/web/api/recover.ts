import type { VercelRequest, VercelResponse } from '@vercel/node'
import { emailLicense, readJson, sql } from './_lib'

interface Body {
  email?: string
}

// POST { email } → emails every active license for that address. Always answers 200
// (even when nothing matches) so the endpoint never reveals which emails bought.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false })
    return
  }
  const { email } = await readJson<Body>(req)
  if (email) {
    const rows = await sql`
      select license_key from licenses where lower(email) = lower(${email}) and status = 'active'
    `
    for (const row of rows) await emailLicense(email, row.license_key)
  }
  res.status(200).json({ ok: true })
}
