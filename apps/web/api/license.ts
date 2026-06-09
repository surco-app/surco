import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql, stripe } from './_lib'

// GET ?session_id=… → the license key minted for a paid checkout session, for the
// success page to display. Returns 202 { pending } while the webhook hasn't recorded
// the license yet, so the page can poll until it appears.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : ''
  if (!sessionId) {
    res.status(400).json({ error: 'missing_session' })
    return
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') {
      res.status(202).json({ pending: true })
      return
    }
    const rows = await sql`select license_key, email from licenses where stripe_session_id = ${sessionId}`
    if (rows.length === 0) {
      res.status(202).json({ pending: true })
      return
    }
    res.status(200).json({ key: rows[0].license_key, email: rows[0].email })
  } catch {
    res.status(404).json({ error: 'not_found' })
  }
}
