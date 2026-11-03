import { useTranslation } from 'react-i18next'
import { HERO_ANCHORS } from '../lib/sceneAnchors'
import Icon, { type GlyphName } from './Icon'

const ICONS: Record<(typeof HERO_ANCHORS)[number]['key'], GlyphName> = {
  quality: 'spectrum',
  tag: 'tag',
  export: 'upload',
}

export default function HeroAnchors() {
  const { t } = useTranslation()

  return (
    <nav
      data-testid="hero-anchors"
      aria-label={t('home.anchors.see')}
      className="mx-auto mt-8 grid max-w-5xl gap-3 text-left sm:grid-cols-3"
    >
      {HERO_ANCHORS.map(({ key, target }) => (
        <a
          key={key}
          href={`#${target}`}
          data-testid={`hero-anchor-${key}`}
          className="group flex gap-3 rounded-xl border border-line bg-surface2/60 px-4 py-4 transition-colors hover:border-blue focus-visible:outline-2 focus-visible:outline-blue"
        >
          <Icon name={ICONS[key]} className="mt-0.5 size-[17px] flex-none text-blue" />
          <span className="flex flex-col gap-1">
            <b className="font-semibold tracking-[-0.005em]">{t(`home.anchors.${key}.lead`)}</b>
            <span className="text-sm leading-snug text-muted">{t(`home.anchors.${key}.rest`)}</span>
            <span className="mt-1 text-sm text-blue">
              {t('home.anchors.see')} <span aria-hidden="true">↓</span>
            </span>
          </span>
        </a>
      ))}
    </nav>
  )
}
