import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'

export default function Footer() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const featuresHref = PAGES.features[lang]
  const guideHref = PAGES.guide[lang]
  const changelogHref = PAGES.changelog[lang]

  return (
    <footer className="relative mt-10 border-t border-line/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.8fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/icon-128.webp" alt="Surco" width={128} height={128} className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Surco</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{t('footer.tagline')}</p>
          <p className="mt-5 inline-flex rounded-full border border-line bg-surface/40 px-3 py-1 font-mono text-xs text-muted">
            {t('available')}
          </p>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-faint">{t('betaNote')}</p>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">
            {t('footer.product')}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            <li>
              <a href={featuresHref} className="transition-colors hover:text-fg">
                {t('nav.funciones')}
              </a>
            </li>
            <li>
              <a href={`${featuresHref}#instalar`} className="transition-colors hover:text-fg">
                {t('nav.instalar')}
              </a>
            </li>
            <li>
              <a href={`${featuresHref}#faq`} className="transition-colors hover:text-fg">
                {t('nav.faq')}
              </a>
            </li>
            <li>
              <a href={guideHref} className="transition-colors hover:text-fg">
                {t('nav.guia')}
              </a>
            </li>
            <li>
              <a href={changelogHref} className="transition-colors hover:text-fg">
                {t('nav.cambios')}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">
            {t('footer.contactHeading')}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            <li>
              <a href="mailto:hello@vicent.io" className="transition-colors hover:text-fg">
                hello@vicent.io
              </a>
            </li>
            <li>
              <a
                href="https://vicent.io"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-fg"
              >
                vicent.io
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-faint sm:flex-row">
          <span>{t('footer.copyright')}</span>
          <span>{t('footer.slogan')}</span>
        </div>
      </div>
    </footer>
  )
}
