import { useTranslation } from 'react-i18next'
import { DONATE_URL } from '../config'
import Reveal from './Reveal'

export default function Pricing() {
  const { t } = useTranslation()

  return (
    <section id="precio" className="scroll-mt-24 pt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('pricing.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('pricing.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('pricing.lede')}</p>
      </Reveal>

      <Reveal>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href="#instalar"
            className="inline-flex w-fit items-center gap-1 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-[color,border-color,scale] duration-200 hover:border-blue/50 hover:text-blue active:scale-[0.96]"
          >
            {t('pricing.cta')} →
          </a>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-blue px-5 py-2.5 text-sm font-semibold text-bg shadow-lg shadow-blue/20 transition-[background-color,box-shadow,translate,scale] duration-200 hover:bg-cyan hover:shadow-xl hover:shadow-cyan/25 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {t('pricing.donate')}
          </a>
        </div>
      </Reveal>
    </section>
  )
}
