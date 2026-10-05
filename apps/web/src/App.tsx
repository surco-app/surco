import { useTranslation } from 'react-i18next'
import BrewCommand from './components/BrewCommand'
import DownloadButton from './components/DownloadButton'
import DownloadCount from './components/DownloadCount'
import Footer from './components/Footer'
import Header from './components/Header'
import HeroAnchors from './components/HeroAnchors'
import HeroApp from './components/HeroApp'
import Kicker from './components/Kicker'
import Reveal from './components/Reveal'
import ScrollProgress from './components/ScrollProgress'
import SectionView from './components/SectionView'
import ReplaceScene from './components/scenes/ReplaceScene'
import Walkthrough from './components/Walkthrough'
import { PAGES } from './lib/nav'

// The home page is three things: what this is, what it does to a track, and how to
// get it. Everything that used to sit below — the feature lists, the five-app
// comparison, the shortcut table, the FAQ — moved to the features page, because
// eight stacked sections can each be well designed and still never feel minimal.

// Proper nouns, so the same list serves every language.
const INTEGRATIONS = [
  'Discogs',
  'Bandcamp',
  'Deezer',
  'Apple Music',
  'Engine DJ',
  'rekordbox',
  'Traktor',
  'Serato',
]

export default function App() {
  const { t, i18n } = useTranslation()
  const featuresHref = PAGES.features[i18n.language === 'en' ? 'en' : 'es']

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />

      <Header />

      <main id="main" className="relative overflow-x-clip">
        {/* One column, centred: headline, one sentence, the download, then the product
            whole underneath. The headline and the window used to share a row, with the window
            running off the right edge; the crop cut the form and the convert button, the part
            that shows what Surco does. The three anchors follow the window, where they
            confirm what the picture just showed instead of queueing under the button. */}
        <section className="mx-auto max-w-6xl px-6 pt-10 pb-12 text-center sm:pt-14 lg:pt-16 lg:pb-16">
          <Reveal eager>
            {/* Fixed height so the pill landing after the releases fetch pushes nothing down. */}
            <div className="mb-6 flex h-8 items-center justify-center">
              <DownloadCount pill />
            </div>
          </Reveal>
          <Reveal eager>
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.5rem] lg:leading-[1.03]">
              {t('hero.h1a')}
              <br />
              {t('hero.h1b')}
            </h1>
          </Reveal>
          <Reveal eager delay={80}>
            <p className="mx-auto mt-5 max-w-xl leading-relaxed text-pretty text-muted">
              {t('home.heroLede')}
            </p>
          </Reveal>
          <Reveal eager delay={150}>
            <DownloadButton location="hero" note={t('home.heroFree')} center showCount={false} />
          </Reveal>
          <Reveal eager delay={220}>
            <div className="relative isolate mx-auto mt-12 max-w-5xl text-left">
              <div className="hero-light pointer-events-none absolute top-0 left-1/2 -z-10 h-[36rem] w-[140%] -translate-x-1/2 -translate-y-1/2" />
              <HeroApp video />
            </div>
          </Reveal>
          <Reveal eager delay={280}>
            <HeroAnchors />
          </Reveal>
        </section>

        {/* The names of the tools Surco talks to, doing two jobs at once: they stand in
            for social proof the download count can't carry at three digits, and they say
            what kind of program this is faster than a sentence can: a visitor who knows
            Discogs and rekordbox places Surco the moment they read them. Eager like the
            rest of the hero, because the row sits right on the fold and a scroll-triggered
            reveal would hold that context back until the visitor had already decided. */}
        <Reveal eager delay={300}>
          <section className="mx-auto max-w-6xl px-6 pb-4">
            <div className="flex flex-col gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:gap-6">
              <p className="font-mono text-xs tracking-wider text-faint uppercase">
                {t('home.worksWith')}
              </p>
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                {INTEGRATIONS.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </section>
        </Reveal>

        {/* Replacing a track already in Apple Music and rekordbox, right under the hero.
            Few users know it exists, and it saves the job DJs dread most: re-adding a
            better copy of a track to every playlist it was in. At the end of the
            walkthrough it read as a footnote. */}
        <section className="mx-auto max-w-6xl px-6 pt-20 sm:pt-24">
          <Reveal>
            <Kicker>{t('home.replace.kicker')}</Kicker>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t('home.replace.title')}
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
              {t('home.replace.lede')}
            </p>
          </Reveal>
          <Reveal delay={120}>
            <ReplaceScene />
          </Reveal>
        </section>

        {/* One measure from the hero down through the walkthrough. The page used to
            step from a 1152px hero to a 1024px body, and the seam landed exactly on
            the heading that introduces the steps. */}
        <div className="mx-auto max-w-6xl px-6">
          <Walkthrough />
        </div>

        {/* pb is smaller than pt: the footer brings its own py-14, and the two
            together left about 150px of empty background between the last link on
            the page and the first line of the footer. */}
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-12 sm:pt-28 sm:pb-16">
          <SectionView location="home-closing" />
          <Reveal>
            <div className="text-center">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                {t('home.closeTitle')}
              </h2>
              {/* Was a mono footnote below the button, in the pile of small print. It is an
                  argument, not a caveat, so it sits with the headline it supports. */}
              <p className="mx-auto mt-4 max-w-lg leading-relaxed text-pretty text-muted">
                {t('home.closeNote')}
              </p>
            </div>

            {/* The two ways in, side by side. They used to be stacked with five other lines
                between and below them — button, Intel link, count, note, command, warning —
                all at a similar weight, so the actual choice the visitor makes was buried. */}
            {/* min-w-0 on both cards: a grid item's default `min-width: auto` sizes it to
                its widest child, so the download meta and the brew command held the cards
                at 513px inside a 342px column and the page clipped them off the right. */}
            <div className="mx-auto mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
              <div className="inset-shadow-edge min-w-0 rounded-2xl border border-blue/30 bg-gradient-to-b from-blue/[0.07] to-transparent p-5 sm:p-6">
                <p className="font-mono text-xs tracking-wider text-faint uppercase">
                  {t('home.closeDirect')}
                </p>
                <DownloadButton location="home-closing" />
              </div>
              <BrewCommand
                location="home-closing"
                className="inset-shadow-edge min-w-0 rounded-2xl border border-line bg-surface2/40 p-5 sm:p-6"
              />
            </div>

            <div className="mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-2xl border border-line bg-surface/25 px-5 py-4">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 flex-none text-green"
              >
                <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
                <path d="M9 12.5l2 2 4-4" />
              </svg>
              {/* The originals promise is a reason to trust the download, so it reads as one:
                  the claim in the page's own text colour, the mechanism after it. As a block
                  of small mono type it was the last thing a visitor saw before leaving. */}
              <p className="text-sm leading-relaxed text-pretty text-faint">
                <b className="font-semibold text-muted">{t('home.closeSafeLead')}</b>{' '}
                {t('home.closeSafeRest')}
              </p>
            </div>

            <div className="text-center">
              <a
                href={featuresHref}
                className="mt-10 inline-flex items-center text-sm font-medium text-muted transition-colors hover:text-blue"
              >
                {t('home.allFeatures')}
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
