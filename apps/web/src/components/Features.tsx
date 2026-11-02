import { useTranslation } from 'react-i18next'
import Band from './Band'
import DownloadButton from './DownloadButton'
import Faq from './Faq'
import Footer from './Footer'
import Header from './Header'
import InstallSection from './InstallSection'
import Kicker from './Kicker'
import Reveal from './Reveal'
import Speed from './Speed'
import Stopwatch from './Stopwatch'

const GROUP_IDS = ['convert', 'tag', 'analyze', 'dj', 'library', 'safety']

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg">
      {k}
    </kbd>
  )
}

export default function Features() {
  const { t } = useTranslation()
  const featureGroups = t('features.groups', { returnObjects: true }) as {
    kick: string
    title: string
    replaces: string
    items: { t: string; s: string; d: string }[]
  }[]
  const shortcutLabels = t('shortcuts.items', { returnObjects: true }) as string[]
  const shortcutKeys: string[][] = [
    ['⌘', 'O'],
    ['⌘', '↵'],
    ['⌘', '⇧', '↵'],
    [t('keys.space')],
    ['J', 'K'],
    ['/'],
  ]

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-bg text-fg antialiased">
      <Header page="features" />

      {/* Same measure as the home. The two pages sit one click apart in the nav and
          the body used to step from 1152px to 1024px on the way over. */}
      <main id="main" className="relative mx-auto max-w-6xl px-6 sm:px-10">
        <section className="pt-16 pb-8 sm:pt-24">
          <Reveal eager>
            <Kicker>{t('features.kicker')}</Kicker>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('features.title')}
            </h1>
            <p className="mt-4 max-w-2xl leading-relaxed text-pretty text-muted">
              {t('features.lede')}
            </p>
          </Reveal>
          <Reveal eager delay={120}>
            <nav
              data-testid="features-index"
              aria-label={t('features.kicker')}
              className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
            >
              {featureGroups.map((g, i) => (
                <a
                  key={GROUP_IDS[i]}
                  href={`#${GROUP_IDS[i]}`}
                  className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-blue focus-visible:outline-2 focus-visible:outline-blue"
                >
                  <span className="text-sm font-semibold text-fg">{g.title}</span>
                  <span className="text-xs text-faint tabular-nums">
                    {t('features.count', { count: g.items.length })}
                  </span>
                </a>
              ))}
            </nav>
          </Reveal>
        </section>

        <div id="funciones" className="pb-20">
          {featureGroups.map((g, i) => (
            <section
              key={GROUP_IDS[i]}
              id={GROUP_IDS[i]}
              data-testid={`features-group-${GROUP_IDS[i]}`}
              className="grid scroll-mt-24 gap-x-14 gap-y-4 pt-16 lg:grid-cols-[16rem_minmax(0,1fr)]"
            >
              <Reveal className="lg:sticky lg:top-24 lg:self-start">
                <h2 className="text-2xl font-semibold tracking-tight text-balance text-fg">
                  {g.title}
                </h2>
                <p className="mt-1.5 text-sm text-faint">{g.replaces}</p>
              </Reveal>
              <Reveal>
                <div className="max-w-2xl border-t border-line">
                  {g.items.map((it) => (
                    <details key={it.t} className="group border-b border-line">
                      <summary className="relative cursor-pointer list-none py-3.5 pr-8 focus-visible:outline-2 focus-visible:outline-blue [&::-webkit-details-marker]:hidden">
                        <span className="block font-semibold text-fg">{it.t}</span>
                        <span className="block text-[15px] text-muted">{it.s}</span>
                        <span
                          aria-hidden="true"
                          className="absolute top-3.5 right-1 font-mono text-lg text-faint transition-transform group-open:rotate-45"
                        >
                          +
                        </span>
                      </summary>
                      <p className="pb-4 text-[15px] leading-relaxed text-pretty text-muted">
                        {it.d}
                      </p>
                    </details>
                  ))}
                </div>
              </Reveal>
            </section>
          ))}
        </div>

        <Speed />

        <Stopwatch />

        <section id="atajos" className="scroll-mt-24 py-16">
          <Reveal>
            <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
              <div>
                <Kicker>{t('shortcuts.kicker')}</Kicker>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  {t('shortcuts.title')}
                </h2>
                <p className="mt-3 leading-relaxed text-pretty text-muted">{t('shortcuts.lede')}</p>
              </div>
              <div className="space-y-2.5">
                {shortcutLabels.map((label, i) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-xl bg-bg/50 px-4 py-2.5"
                  >
                    <span className="text-sm text-fg">{label}</span>
                    <span className="flex items-center gap-1">
                      {shortcutKeys[i].map((k) => (
                        <Kbd key={k} k={k} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        <Band tone="deep">
          <InstallSection />
          <Faq />
        </Band>

        <section className="py-24 text-center">
          <Reveal>
            <div className="flex flex-col items-center gap-4">
              <DownloadButton location="features" />
              <p className="text-sm text-faint">{t('home.closeNote')}</p>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
