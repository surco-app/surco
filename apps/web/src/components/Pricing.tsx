import { useTranslation } from 'react-i18next'
import { DONATE_URL } from '../config'
import Reveal from './Reveal'

export default function Pricing() {
  const { t } = useTranslation()

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
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href="#instalar"
            className="inline-flex w-fit items-center gap-1 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-blue/50 hover:text-blue"
          >
            {t('pricing.cta')} →
          </a>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted transition-colors hover:text-blue"
          >
            {t('pricing.donate')}
          </a>
        </div>
      </Reveal>
    </section>
  )
}
