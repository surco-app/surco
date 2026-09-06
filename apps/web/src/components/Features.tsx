import { useTranslation } from 'react-i18next'
import { useAutoLanguage } from '../lib/useAutoLanguage'
import Band from './Band'
import DownloadButton from './DownloadButton'
import Faq from './Faq'
import Footer from './Footer'
import Header from './Header'
import HeroApp from './HeroApp'
import Icon, { type GlyphName } from './Icon'
import InstallSection from './InstallSection'
import Kicker from './Kicker'
import Reveal from './Reveal'
import Speed from './Speed'

const FEATURE_ICONS: GlyphName[] = ['convert', 'tag', 'spectrum', 'upload']

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg shadow-sm">
      {k}
    </kbd>
  )
}

// Everything the home page deliberately doesn't say. This is the page for someone
// who has already decided they're interested and now wants to check whether their
// format, their gear and their workflow are covered — so density is the point here,
// where on the home page it was the problem.
export default function Features() {
  const { t } = useTranslation()
  useAutoLanguage()
  const featureGroups = t('features.groups', { returnObjects: true }) as {
    kick: string
    title: string
    replaces: string
    items: { t: string; d: string }[]
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
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <Header page="features" />

      {/* Same measure as the home. The two pages sit one click apart in the nav and
          the body used to step from 1152px to 1024px on the way over. */}
      <main id="main" className="relative mx-auto max-w-6xl px-6">
        <section className="pt-16 pb-8 sm:pt-24">
          <Reveal eager>
            <Kicker>{t('features.kicker')}</Kicker>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('features.title')}
            </h1>
          </Reveal>
          {/* The page used to go from this title straight into twenty bullets, with no
              picture of the thing being described until the walkthrough far below. The
              window says what kind of program this is faster than the list can, and it
              is the home's own asset, already cached for anyone arriving from there.
              No video here: on this page the still does the job and the loop would be
              a second copy of a megabyte for a decoration. */}
          <Reveal eager delay={120}>
            <div className="mt-10">
              <HeroApp />
            </div>
          </Reveal>
        </section>

        <section id="funciones" className="scroll-mt-24 pt-6 pb-20">
          <div className="grid gap-12 sm:grid-cols-2">
            {featureGroups.map((g, i) => (
              <Reveal key={g.title} delay={(i % 2) * 90}>
                <div className="h-full">
                  <div className="mb-4 flex size-9 items-center justify-center rounded-lg border border-blue/30 bg-blue/10 text-blue">
                    <Icon name={FEATURE_ICONS[i]} className="size-4.5" />
                  </div>
                  <h2 className="text-lg font-semibold text-fg">{g.title}</h2>
                  <p className="mt-1 font-mono text-xs text-faint">{g.replaces}</p>
                  <ul className="mt-4 space-y-3">
                    {g.items.map((it) => (
                      <li key={it.t} className="flex gap-2.5 text-sm leading-relaxed">
                        <span className="text-cyan">·</span>
                        <span>
                          <span className="font-medium text-fg">{it.t}</span>{' '}
                          <span className="text-muted">{it.d}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <Speed />

        <section id="atajos" className="scroll-mt-24 py-16">
          <Reveal>
            <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
              <div>
                <Kicker>{t('shortcuts.kicker')}</Kicker>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
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
              <p className="font-mono text-xs text-faint">{t('home.closeNote')}</p>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
