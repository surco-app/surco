import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCheckoutSession } from './_lib'

// POST → returns the Stripe Checkout URL for the website "Buy" button to redirect to.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  try {
    const session = await createCheckoutSession('web')
    res.status(200).json({ url: session.url })
  } catch {
    res.status(500).json({ error: 'checkout_failed' })
  }
}
