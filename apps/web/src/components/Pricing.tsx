import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BETA_MODE, FREE_MONTHLY_CONVERSIONS, PRO_PRICE_EUR, SPONSOR_URL } from '../config'
import Reveal from './Reveal'

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-green"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function Features({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-sm text-fg">
          <Check />
          {f}
        </li>
      ))}
    </ul>
  )
}

export default function Pricing() {
  const { t, i18n } = useTranslation()
  const [loading, setLoading] = useState(false)
  const free = t('pricing.free.features', {
    returnObjects: true,
    limit: FREE_MONTHLY_CONVERSIONS,
  }) as string[]
  const pro = t('pricing.pro.features', { returnObjects: true }) as string[]

  // Starts a Stripe Checkout: ask the serverless function for a session URL, then hand
  // the browser over to Stripe. Only reachable once the beta is over (BETA_MODE off).
  async function goPro(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang: i18n.language }),
      })
      const data = (await res.json()) as { url?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
    } catch {
      // fall through to re-enable the button
    }
    setLoading(false)
  }

  return (
    <section id="precio" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('pricing.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('pricing.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">{t('pricing.lede')}</p>
      </Reveal>

      {BETA_MODE && (
        <Reveal>
          <p className="mt-6 rounded-2xl border border-blue/30 bg-blue/5 px-5 py-3 text-sm text-fg">
            {t('pricing.betaBanner')}
          </p>
        </Reveal>
      )}

      <Reveal>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {/* Free tier */}
          <div className="flex flex-col rounded-3xl border border-line bg-surface2/40 p-8">
            <div className="font-mono text-xs tracking-wider text-blue uppercase">
              {t('pricing.free.name')}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-bold">{t('pricing.free.price')}</span>
              <span className="text-sm text-muted">{t('pricing.free.period')}</span>
            </div>
            <a
              href="#instalar"
              className="mt-6 inline-flex w-fit items-center gap-1 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-blue/50 hover:text-blue"
            >
              {t('pricing.free.cta')} →
            </a>
            <div className="mt-8">
              <Features items={free} />
            </div>
          </div>

          {/* Pro tier */}
          <div className="flex flex-col rounded-3xl border border-blue/40 bg-blue/[0.04] p-8">
            <div className="font-mono text-xs tracking-wider text-blue uppercase">
              {t('pricing.pro.name')}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-grad">€{PRO_PRICE_EUR}</span>
              <span className="text-sm text-muted">{t('pricing.pro.period')}</span>
            </div>
            {BETA_MODE ? (
              <span className="mt-6 inline-flex w-fit items-center rounded-full border border-blue/40 bg-blue/10 px-4 py-2 text-sm font-medium text-blue">
                {t('pricing.pro.betaCta')}
              </span>
            ) : (
              <button
                type="button"
                onClick={goPro}
                disabled={loading}
                className="mt-6 inline-flex w-fit items-center rounded-full bg-blue px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-cyan disabled:opacity-60"
              >
                {loading ? t('pricing.pro.loading') : t('pricing.pro.cta')}
              </button>
            )}
            <div className="mt-8">
              <Features items={pro} />
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-6 flex flex-col items-start gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          {/* No one can have bought during the beta, so recovery is hidden until then. */}
          {!BETA_MODE && (
            <a href="/recover" className="text-blue transition-colors hover:text-cyan">
              {t('pricing.pro.recover')}
            </a>
          )}
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-blue"
          >
            {t('pricing.sponsor.cta')}
          </a>
        </div>
      </Reveal>
    </section>
  )
}
