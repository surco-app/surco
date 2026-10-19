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
      className="group inline-flex items-center gap-2 rounded-full bg-surface/70 py-1.5 pr-3.5 pl-3 text-[0.8125rem] text-muted ring-1 ring-line backdrop-blur-sm transition-colors hover:text-fg hover:ring-blue/60"
    >
      <span className="text-[0.6875rem] font-bold tracking-wider text-blue uppercase">
        {t('hero.latestRelease', { version: latest.version })}
      </span>
      <span aria-hidden="true" className="text-line">
        ·
      </span>
      <span>{latest.title}</span>
      <span
        aria-hidden="true"
        className="text-blue transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </a>
  )
}
