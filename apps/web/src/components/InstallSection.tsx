import { useTranslation } from 'react-i18next'
import BrewCommand from './BrewCommand'
import DownloadButton from './DownloadButton'
import Kicker from './Kicker'
import Reveal from './Reveal'

export default function InstallSection() {
  const { t } = useTranslation()

  return (
    // The band around this section carries no padding of its own, so the first
    // section inside it has to open the gap: without pt the kicker sat flush against
    // the band's top border. pb-24 alone was enough while this sat mid-page.
    <section id="instalar" className="scroll-mt-24 py-24">
      <Reveal>
        <Kicker>{t('install.kicker')}</Kicker>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('install.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('install.lede')}</p>
        <DownloadButton location="install" showMeta={false} />
      </Reveal>

      <Reveal delay={120}>
        <BrewCommand className="mt-10 max-w-2xl" />
      </Reveal>
    </section>
  )
}
