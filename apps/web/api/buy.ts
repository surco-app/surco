import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCheckoutSession, SITE } from './_lib'

// GET → creates a checkout session and 303-redirects straight to Stripe. This is the
// link the desktop app opens (shell.openExternal `${SITE}/buy?src=app`), and it doubles
// as a shareable buy link.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const source = typeof req.query.src === 'string' ? req.query.src : 'link'
    const session = await createCheckoutSession(source)
    res.redirect(303, session.url ?? `${SITE}/?checkout=error`)
  } catch {
    res.redirect(303, `${SITE}/?checkout=error`)
  }
}
