import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import DownloadCount from './DownloadCount'

export default function Footer() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Language
  const featuresHref = PAGES.features[lang]
  const guideHref = PAGES.guide[lang]
  const useCasesHref = PAGES.useCases[lang]
  const changelogHref = PAGES.changelog[lang]
  const flacToAiffHref = PAGES.flacToAiff[lang]
  const privacyHref = PAGES.privacy[lang]

  return (
    <footer className="relative mt-10 border-t border-line/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:px-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.8fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Surco" width={48} height={48} className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Surco</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{t('footer.tagline')}</p>
          <p className="mt-5 inline-flex rounded-full border border-line bg-surface/40 px-3 py-1 text-xs font-medium text-muted">
            {t('available')}
          </p>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-faint">{t('footerNote')}</p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-faint">{t('footer.product')}</h3>
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
              <a
                href={useCasesHref}
                data-testid="footer-use-cases"
                className="transition-colors hover:text-fg"
              >
                {t('nav.casos')}
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
          <h3 className="text-sm font-medium text-faint">{t('footer.convertHeading')}</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            <li>
              <a
                href={flacToAiffHref}
                data-testid="footer-flac-to-aiff"
                className="transition-colors hover:text-fg"
              >
                {t('footer.flacToAiff')}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-medium text-faint">{t('footer.contactHeading')}</h3>
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:px-10 py-6 text-xs text-faint sm:flex-row">
          <span className="flex gap-2">
            <span>{t('footer.copyright')}</span>
            <DownloadCount />
          </span>
          <a
            href={privacyHref}
            data-testid="footer-privacy"
            className="transition-colors hover:text-fg"
          >
            {t('footer.privacy')}
          </a>
          <span>{t('footer.slogan')}</span>
        </div>
      </div>
    </footer>
  )
}
