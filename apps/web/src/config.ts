// Web mirror of the desktop's freemium flags. While BETA_MODE is on, the pricing
// section shows the freemium structure but keeps Pro free (a "free during the beta"
// banner, no live checkout) — matching the desktop, where every feature is unlocked.
// Set VITE_SURCO_BETA=0 at build time to switch the site to live Pro pricing + Stripe
// checkout the moment the beta ends.
export const BETA_MODE = import.meta.env.VITE_SURCO_BETA !== '0'

// One-time Pro price in euros. Mirrors PRO_PRICE_EUR on the desktop and the API.
export const PRO_PRICE_EUR = Number(import.meta.env.VITE_PRO_PRICE_EUR ?? '29')

// Free-tier monthly conversion cap shown in the pricing copy. Mirrors the desktop's
// SURCO_FREE_MONTHLY (which actually enforces it); defaults to 25.
export const FREE_MONTHLY_CONVERSIONS = Number(import.meta.env.VITE_SURCO_FREE_MONTHLY ?? '25')

// Kept enabled across the freemium switch: the desktop Stats "donate" and the web
// pricing section both point here, so it stays a single constant.
export const SPONSOR_URL = 'https://github.com/sponsors/vigosan'
