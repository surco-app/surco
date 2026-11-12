import { Trans, useTranslation } from 'react-i18next'
import BrewCommand from './components/BrewCommand'
import DownloadButton from './components/DownloadButton'
import Footer from './components/Footer'
import Header from './components/Header'
import HeroAnchors from './components/HeroAnchors'
import HeroApp from './components/HeroApp'
import LatestRelease from './components/LatestRelease'
import LibraryReview from './components/LibraryReview'
import Reveal from './components/Reveal'
import ScrollProgress from './components/ScrollProgress'
import SectionView from './components/SectionView'
import Spotlight from './components/Spotlight'
import CuesScene from './components/scenes/CuesScene'
import GridScene from './components/scenes/GridScene'
import ReplaceScene from './components/scenes/ReplaceScene'
import SyncScene from './components/scenes/SyncScene'
import Walkthrough from './components/Walkthrough'
import type { Language } from './i18n'
import { PAGES } from './lib/nav'
import { SCENE_ANCHORS, SECTION_VIEWS } from './lib/sceneAnchors'

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
  'VirtualDJ',
]

export default function App() {
  const { t, i18n } = useTranslation()
  const featuresHref = PAGES.features[i18n.language as Language]
  const statsHref = PAGES.stats[i18n.language as Language]

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-bg text-fg antialiased">
      <ScrollProgress />

      <Header />

      <main id="main" className="relative overflow-x-clip">
        {/* One column, centred: headline, one sentence, the download, then the product
            whole underneath. The headline and the window used to share a row, with the window
            running off the right edge; the crop cut the form and the convert button, the part
            that shows what Surco does. The three anchors follow the window, where they
            confirm what the picture just showed instead of queueing under the button. */}
        <section className="mx-auto max-w-6xl px-6 sm:px-10 pt-10 pb-12 text-center sm:pt-14 lg:pt-12 lg:pb-16">
          <Reveal eager>
            <div className="mb-6 flex min-h-8 items-center justify-center">
              <LatestRelease />
            </div>
          </Reveal>
          <Reveal eager>
            <h1 className="mx-auto max-w-4xl text-[min(2.25rem,7.6vw)] leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl lg:text-[4.5rem] lg:leading-[1.02]">
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
            <div id="hero-download">
              <DownloadButton location="hero" note={t('home.heroFree')} center />
            </div>
          </Reveal>
          <Reveal eager delay={220}>
            <div className="relative isolate mx-auto mt-8 max-w-5xl text-left">
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
          <section className="mx-auto max-w-6xl px-6 sm:px-10 pb-4">
            <div className="flex flex-col gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:gap-6">
              <p className="text-sm text-faint">{t('home.worksWith')}</p>
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                {INTEGRATIONS.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </section>
        </Reveal>

        {/* One measure from the hero down through the walkthrough. The page used to
            step from a 1152px hero to a 1024px body, and the seam landed exactly on
            the heading that introduces the steps. */}
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
          <Walkthrough />
          <Spotlight
            id={SCENE_ANCHORS.cues}
            view={SECTION_VIEWS.cues}
            copy="cues"
            points={['oneClick', 'yourFlow', 'programs']}
            scene={<CuesScene />}
          >
            <GridScene />
          </Spotlight>
          <Spotlight
            id={SCENE_ANCHORS.replace}
            view={SECTION_VIEWS.replace}
            copy="replace"
            points={['anyFormat', 'playlists', 'programs']}
            scene={<ReplaceScene />}
          />
          <Spotlight
            id={SCENE_ANCHORS.sync}
            view={SECTION_VIEWS.sync}
            copy="sync"
            points={['anyTab', 'sameTrack', 'waits']}
            scene={<SyncScene />}
          />
          <LibraryReview />
        </div>

        {/* pb is smaller than pt: the footer brings its own py-14, and the two
            together left about 150px of empty background between the last link on
            the page and the first line of the footer. */}
        <section
          id="instalar"
          className="mx-auto max-w-6xl scroll-mt-8 px-6 sm:px-10 pt-20 pb-12 sm:pt-28 sm:pb-16"
        >
          <SectionView location="home-closing" />
          <Reveal>
            <div className="text-center">
              <h2 className="mx-auto max-w-2xl text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-5xl">
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
              <div className="min-w-0 rounded-2xl border border-blue/30 bg-blue/[0.05] p-5 sm:p-6">
                <p className="text-sm font-medium text-faint">{t('home.closeDirect')}</p>
                <DownloadButton location="home-closing" />
              </div>
              <BrewCommand
                location="home-closing"
                className="min-w-0 rounded-2xl border border-line bg-surface2/40 p-5 sm:p-6"
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

            <div className="mx-auto mt-2.5 flex max-w-3xl items-start gap-3 rounded-2xl border border-line bg-surface/25 px-5 py-4">
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
                <path d="M9.9 4.2A10 10 0 0 1 12 4c5 0 9 4.5 10 8a13 13 0 0 1-2.2 3.7" />
                <path d="M6.6 6.6C4.4 8 2.8 10.1 2 12c1 3.5 5 8 10 8a10 10 0 0 0 5.4-1.6" />
                <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
                <path d="M2 2l20 20" />
              </svg>
              <p className="text-sm leading-relaxed text-pretty text-faint">
                <b className="font-semibold text-muted">{t('home.closeStatsLead')}</b>{' '}
                <Trans
                  i18nKey="home.closeStatsRest"
                  components={{
                    stats: (
                      <a
                        href={statsHref}
                        data-testid="home-closing-stats"
                        className="font-medium text-blue transition-colors hover:text-cyan"
                      >
                        {t('nav.estadisticas')}
                      </a>
                    ),
                  }}
                />
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
