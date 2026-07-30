import { useTranslation } from 'react-i18next'
import BrewCommand from './BrewCommand'
import DownloadButton from './DownloadButton'
import Kicker from './Kicker'
import Reveal from './Reveal'

export default function InstallSection() {
  const { t } = useTranslation()

  return (
    <section id="instalar" className="scroll-mt-24 pb-24">
      <Reveal>
        <Kicker>{t('install.kicker')}</Kicker>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('install.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('install.lede')}</p>
        <DownloadButton showMeta={false} />
      </Reveal>

      <Reveal delay={120}>
        <BrewCommand className="mt-10 max-w-2xl" />
      </Reveal>
    </section>
  )
}
