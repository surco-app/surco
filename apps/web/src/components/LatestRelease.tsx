import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'

type Release = { version: string; title: string }

export default function LatestRelease() {
  const { t, i18n } = useTranslation()
  const [latest] = t('changelog.releases', { returnObjects: true }) as Release[]
  const href = PAGES.changelog[i18n.language === 'en' ? 'en' : 'es']

  return (
    <a
      href={href}
      data-testid="latest-release"
      className="group inline-flex flex-wrap items-baseline justify-center gap-x-2 text-sm text-muted transition-colors hover:text-fg"
    >
      <span className="font-semibold whitespace-nowrap text-blue">
        {t('hero.latestRelease', { version: latest.version })}
      </span>
      <span aria-hidden="true" className="text-faint">
        ·
      </span>
      <span>
        {latest.title}{' '}
        <span
          aria-hidden="true"
          className="inline-block text-blue transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </a>
  )
}
