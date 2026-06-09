import type { VercelRequest, VercelResponse } from '@vercel/node'
import type Stripe from 'stripe'
import { emailLicense, generateLicenseKey, normalizeLang, readRawBody, sql, stripe } from './_lib'

// Stripe needs the exact bytes to verify the signature, so opt out of body parsing.
export const config = { api: { bodyParser: false } }

// Stripe webhook. On a completed checkout it mints a license, stores it in Neon, and
// emails it; on a refund it marks the license refunded so the app downgrades. Always
// verifies the signature first so only Stripe can create licenses.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  let event: Stripe.Event
  try {
    const raw = await readRawBody(req)
    event = stripe.webhooks.constructEvent(
      raw,
      req.headers['stripe-signature'] as string,
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    )
  } catch {
    res.status(400).json({ error: 'invalid_signature' })
    return
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session
      const email = s.customer_details?.email ?? s.customer_email ?? ''
      // Idempotent: the same session never mints two licenses, even on webhook retries.
      const existing = await sql`select 1 from licenses where stripe_session_id = ${s.id}`
      if (existing.length === 0) {
        const key = generateLicenseKey()
        await sql`
          insert into licenses (license_key, email, stripe_session_id, stripe_customer_id, stripe_payment_intent)
          values (${key}, ${email}, ${s.id}, ${(s.customer as string) ?? null}, ${(s.payment_intent as string) ?? null})
        `
        // Language chosen at checkout (metadata), falling back to Stripe's own locale.
        const lang = normalizeLang(s.metadata?.lang ?? s.locale)
        if (email) await emailLicense(email, key, lang)
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge
      await sql`update licenses set status = 'refunded' where stripe_payment_intent = ${charge.payment_intent as string}`
    }
  } catch {
    // Surface a 500 so Stripe retries the delivery rather than dropping a paid order.
    res.status(500).json({ error: 'handler_failed' })
    return
  }

  res.status(200).json({ received: true })
}
