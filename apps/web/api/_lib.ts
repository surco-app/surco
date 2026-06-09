// Shared helpers for the serverless functions. The leading underscore keeps Vercel
// from exposing this file as its own /api route.
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { neon } from '@neondatabase/serverless'
import { Resend } from 'resend'
import Stripe from 'stripe'

// One-time Pro price (euros) and the public site URL, both overridable per env.
export const PRICE_EUR = Number(process.env.PRO_PRICE_EUR ?? '29')
export const SITE = process.env.SITE_URL ?? 'https://getsurco.app'

export const sql = neon(process.env.DATABASE_URL ?? '')
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

// The two languages the site, app and emails speak. Anything else falls back to en.
export type Lang = 'en' | 'es'
export function normalizeLang(x: unknown): Lang {
  return typeof x === 'string' && x.toLowerCase().startsWith('es') ? 'es' : 'en'
}

// One-time Surco Pro checkout. `source` is echoed into metadata so we can tell an
// in-app "Buy" from a website purchase; `lang` localizes the Stripe Checkout UI and
// is carried into metadata so the webhook can email the license in the right language.
// Shared by /api/checkout and /api/buy.
export function createCheckoutSession(
  source: string,
  lang: Lang = 'en',
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    locale: lang,
    metadata: { source, lang },
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: PRICE_EUR * 100,
          product_data: {
            name: 'Surco Pro',
            description: 'Lifetime license — unlimited conversions, batch convert, DJ exports.',
          },
        },
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url: `${SITE}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/?checkout=cancelled`,
  })
}

// SURCO-XXXX-XXXX-XXXX-XXXX in a Crockford-style alphabet (no 0/O/1/I/L/U) so keys
// are easy to read off an email and type without ambiguity. 20 chars ≈ 95 bits.
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
  const bytes = randomBytes(16)
  const groups: string[] = []
  for (let g = 0; g < 4; g++) {
    let s = ''
    for (let i = 0; i < 4; i++) s += alphabet[bytes[g * 4 + i] % alphabet.length]
    groups.push(s)
  }
  return `SURCO-${groups.join('-')}`
}

// Reads the request body as a raw Buffer. Stripe's webhook signature is computed over
// the exact bytes, so the webhook must verify against this, not a re-serialized object.
export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Parses a JSON body from either Vercel's pre-parsed req.body or the raw stream, so the
// endpoints work regardless of whether the platform parsed it for us.
export async function readJson<T>(req: IncomingMessage & { body?: unknown }): Promise<T> {
  if (req.body && typeof req.body === 'object') return req.body as T
  if (typeof req.body === 'string') return JSON.parse(req.body) as T
  const raw = await readRawBody(req)
  return raw.length ? (JSON.parse(raw.toString('utf8')) as T) : ({} as T)
}

// The license email in each language, so buyers get it in the language they used.
function licenseEmail(key: string, lang: Lang): { subject: string; text: string } {
  if (lang === 'es') {
    return {
      subject: 'Tu licencia de Surco Pro',
      text: `¡Gracias por comprar Surco Pro!\n\nTu clave de licencia:\n\n${key}\n\nAbre Surco → pulsa ⌘K → «Surco Pro…» → pega la clave y tu email de compra para activar. Funciona en hasta 3 dispositivos.\n\n¿La perdiste? Recupérala cuando quieras en ${SITE}/recover`,
    }
  }
  return {
    subject: 'Your Surco Pro license',
    text: `Thanks for buying Surco Pro!\n\nYour license key:\n\n${key}\n\nOpen Surco → press ⌘K → "Surco Pro…" → paste the key and your purchase email to activate. It works on up to 3 devices.\n\nLost it? Recover it any time at ${SITE}/recover`,
  }
}

// Emails the license key to the buyer in their language. Best-effort: with no
// RESEND_API_KEY configured it silently no-ops (the success page is the primary
// delivery channel).
export async function emailLicense(email: string, key: string, lang: Lang = 'en'): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const resend = new Resend(apiKey)
  const from = process.env.LICENSE_EMAIL_FROM ?? 'Surco <license@getsurco.app>'
  const { subject, text } = licenseEmail(key, lang)
  await resend.emails.send({ from, to: email, subject, text })
}
