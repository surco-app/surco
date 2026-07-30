import { useTranslation } from 'react-i18next'
import DownloadButton from './components/DownloadButton'
import Footer from './components/Footer'
import Header from './components/Header'
import HeroApp from './components/HeroApp'
import Reveal from './components/Reveal'
import ScrollProgress from './components/ScrollProgress'
import Walkthrough from './components/Walkthrough'
import { PAGES } from './lib/nav'
import { useAutoLanguage } from './lib/useAutoLanguage'

// The home page is three things: what this is, what it does to a track, and how to
// get it. Everything that used to sit below — the feature lists, the five-app
// comparison, the shortcut table, the FAQ — moved to the features page, because
// eight stacked sections can each be well designed and still never feel minimal.
export default function App() {
  const { t, i18n } = useTranslation()
  useAutoLanguage()
  const featuresHref = PAGES.features[i18n.language === 'en' ? 'en' : 'es']

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />

      <Header />

      <main id="main" className="relative">
        <section className="mx-auto grid max-w-6xl items-center gap-10 overflow-hidden px-6 pt-14 pb-14 sm:pt-20 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12 lg:pt-24 lg:pb-20">
          <div>
            <Reveal eager>
              <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                {t('hero.h1a')}
                <br />
                <span className="text-grad text-grad-glow">{t('hero.h1b')}</span>
              </h1>
            </Reveal>
            <Reveal eager delay={80}>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-pretty text-muted">
                {t('home.heroLede')}
              </p>
            </Reveal>
            <Reveal eager delay={150}>
              <DownloadButton />
            </Reveal>
          </div>
          <Reveal eager delay={220} className="lg:-mr-[9vw]">
            <HeroApp />
          </Reveal>
        </section>

        <div className="mx-auto max-w-5xl px-6">
          <Walkthrough />
        </div>

        <section className="mx-auto max-w-5xl px-6 py-28 text-center sm:py-36">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('home.closeTitle')}
            </h2>
            <div className="mt-10 flex flex-col items-center gap-4">
              <DownloadButton />
              <p className="font-mono text-xs text-faint">{t('home.closeNote')}</p>
            </div>
            <a
              href={featuresHref}
              className="mt-14 inline-flex items-center text-sm font-medium text-muted transition-colors hover:text-blue"
            >
              {t('home.allFeatures')}
            </a>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
