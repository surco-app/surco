import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

// Surco is distributed free; sponsorship is the only ask. Kept as a single
// constant so it's trivial to repoint if the funding link changes.
const SPONSOR_URL = 'https://github.com/sponsors/vigosan'

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

export default function Pricing() {
  const { t } = useTranslation()
  const features = t('pricing.card.features', { returnObjects: true }) as string[]

  return (
    <section id="precio" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('pricing.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('pricing.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">{t('pricing.lede')}</p>
      </Reveal>

      <Reveal>
        <div className="mt-10 overflow-hidden rounded-3xl border border-line bg-surface2/40">
          <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="font-mono text-xs tracking-wider text-blue uppercase">
                {t('pricing.card.plan')}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-5xl font-bold text-grad">{t('pricing.card.price')}</span>
                <span className="text-sm text-muted">{t('pricing.card.period')}</span>
              </div>
              <a
                href="#instalar"
                className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-blue transition-colors hover:text-cyan"
              >
                {t('download.free')} →
              </a>
            </div>

            <ul className="space-y-3">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-fg">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col items-start gap-3 border-t border-line/70 bg-bg/30 px-8 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <p className="text-sm text-muted">{t('pricing.sponsor.text')}</p>
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-blue/50 hover:text-blue"
            >
              {t('pricing.sponsor.cta')}
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
