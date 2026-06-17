import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Header from './components/Header'
import Footer from './components/Footer'
import Speed from './components/Speed'
import HowItWorks from './components/HowItWorks'
import Pricing from './components/Pricing'
import Spectrogram from './components/Spectrogram'
import Reveal from './components/Reveal'
import Icon, { type GlyphName } from './components/Icon'
import ScrollProgress from './components/ScrollProgress'
import DownloadButton from './components/DownloadButton'
import InstallSection from './components/InstallSection'
import Faq from './components/Faq'
import Band from './components/Band'
import WaveBackdrop from './components/WaveBackdrop'
import GrooveArcs from './components/GrooveArcs'
import { useAutoLanguage } from './lib/useAutoLanguage'

const cardHover =
  'transition duration-200 hover:-translate-y-1 hover:border-blue/50 hover:shadow-xl hover:shadow-blue/5'

// One glyph per feature card, in the order of the `features.groups` i18n list
// (convert, tag, analyze quality, organize & export).
const FEATURE_ICONS: GlyphName[] = ['convert', 'tag', 'spectrum', 'upload']

// The hero glow drifts at a fraction of the scroll speed so the background
// reads as a deeper layer than the content. Transform-only, rAF-throttled.
function HeroGlow() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate3d(0, ${window.scrollY * 0.12}px, 0)`
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0 h-[760px]"
      style={{
        background:
          'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.20) 0%, rgba(26,27,38,0) 70%)'
      }}
    />
  )
}

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg shadow-sm">
      {k}
    </kbd>
  )
}

export default function App() {
  const { t, i18n } = useTranslation()
  useAutoLanguage()
  const appShot = `/app-${i18n.language === 'en' ? 'en' : 'es'}.webp`
  const featureGroups = t('features.groups', { returnObjects: true }) as {
    kick: string
    title: string
    replaces: string
    items: string[]
  }[]
  const shortcutLabels = t('shortcuts.items', { returnObjects: true }) as string[]
  const shortcutKeys: string[][] = [
    ['⌘', 'O'],
    ['⌘', '↵'],
    ['⌘', '⇧', '↵'],
    [t('keys.space')],
    ['J', 'K'],
    ['/']
  ]
  const stack = t('stack', { returnObjects: true }) as string[]

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />

      <HeroGlow />

      <Header />

      <main id="main" className="relative mx-auto max-w-5xl px-6">
        <div
          className="pointer-events-none absolute inset-x-0 top-[32%] h-[700px]"
          style={{
            background:
              'radial-gradient(50% 50% at 10% 50%, rgba(187,154,247,0.07) 0%, rgba(26,27,38,0) 70%)'
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-[72%] h-[700px]"
          style={{
            background:
              'radial-gradient(50% 50% at 90% 50%, rgba(125,207,255,0.06) 0%, rgba(26,27,38,0) 70%)'
          }}
        />
        <WaveBackdrop className="top-[10%]" side="left" delay="-18s" />
        <GrooveArcs className="top-[40%]" side="right" />
        <WaveBackdrop className="top-[66%]" flip side="left" delay="-29s" />
        <section className="pt-12 pb-24 text-center sm:pt-20">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue/40 bg-blue/10 px-3 py-1 font-mono text-xs text-blue">
              <span
                className="h-1.5 w-1.5 rounded-full bg-blue"
                style={{ animation: 'glow 2s ease-in-out infinite' }}
              />
              {t('betaPill')}
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-7 max-w-4xl text-5xl font-bold tracking-tight text-balance sm:text-7xl">
              {t('hero.h1a')}
              <br />
              <span className="text-grad">{t('hero.h1b')}</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted">
              {t('hero.ledeShort')}
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-6 font-mono text-sm text-muted">
              <span className="text-fg">AIFF</span> <span className="text-cyan">⇄</span>{' '}
              <span className="text-fg">WAV</span> <span className="text-cyan">⇄</span>{' '}
              <span className="text-fg">FLAC</span> <span className="text-cyan">⇄</span>{' '}
              <span className="text-fg">MP3</span>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <div className="flex flex-col items-center">
              <DownloadButton />
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className="relative mt-16 ml-[calc(50%-50vw)] w-screen px-6 sm:mt-20">
              <figure className="relative mx-auto max-w-6xl">
                <div
                  className="pointer-events-none absolute -inset-x-6 -top-10 bottom-10 -z-10"
                  style={{
                    background:
                      'radial-gradient(50% 55% at 50% 0%, rgba(122,162,247,0.22) 0%, rgba(26,27,38,0) 70%)'
                  }}
                />
                <img
                  src={appShot}
                  alt={t('showcase.alt')}
                  width={2000}
                  height={1242}
                  loading="lazy"
                  className="block w-full rounded-2xl border border-line shadow-2xl shadow-black/60 ring-1 ring-white/5"
                />
              </figure>
            </div>
          </Reveal>
        </section>

        <Band tone="deep">
        <section id="analisis" className="scroll-mt-24 py-24">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('analysis.kicker')}</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('analysis.title')}
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('analysis.lede')}</p>
          </Reveal>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Reveal from="left">
              <div className={`inset-shadow-edge rounded-2xl border border-line bg-surface2/50 p-4 ${cardHover}`}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">original.flac</span>
                  <span className="rounded-full bg-green/15 px-2.5 py-0.5 font-mono text-[11px] text-green">
                    {t('analysis.good')}
                  </span>
                </div>
                <Spectrogram axis />
                <p className="mt-3 font-mono text-xs text-muted">
                  {t('analysis.goodCaptionPre')}
                  <span className="text-fg">{t('analysis.goodCaptionHz')}</span>
                  {t('analysis.goodCaptionPost')}
                </p>
              </div>
            </Reveal>

            <Reveal from="right" delay={120}>
              <div className={`inset-shadow-edge rounded-2xl border border-line bg-surface2/50 p-4 ${cardHover}`}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">descarga_320.aiff</span>
                  <span className="rounded-full bg-red/15 px-2.5 py-0.5 font-mono text-[11px] text-red">
                    {t('analysis.suspect')}
                  </span>
                </div>
                <div className="relative">
                  <Spectrogram suspect axis />
                  <div className="pointer-events-none absolute inset-x-0" style={{ top: '27%' }}>
                    <div className="border-t border-dashed border-red/80" />
                    <span className="absolute right-1 -top-5 rounded bg-red/20 px-1.5 py-0.5 font-mono text-[10px] text-red">
                      {t('analysis.wall')}
                    </span>
                  </div>
                </div>
                <p className="mt-3 font-mono text-xs text-muted">
                  {t('analysis.suspectCaptionPre')}
                  <span className="text-red">{t('analysis.suspectCaptionHz')}</span>
                  {t('analysis.suspectCaptionPost')}
                </p>
              </div>
            </Reveal>
          </div>
        </section>
        </Band>

        <Speed />

        <HowItWorks />

        <Band tone="raised">
        <section id="funciones" className="scroll-mt-24 py-24">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('features.kicker')}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('features.title')}
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {featureGroups.map((g, i) => (
              <Reveal key={g.title} delay={(i % 2) * 100}>
                <div className="h-full">
                  <div className="mb-4 flex size-9 items-center justify-center rounded-lg border border-blue/30 bg-blue/10 text-blue">
                    <Icon name={FEATURE_ICONS[i]} className="size-4.5" />
                  </div>
                  <div className="font-mono text-xs text-blue">{g.kick}</div>
                  <h3 className="mt-2 text-lg font-semibold text-fg">{g.title}</h3>
                  <p className="mt-1 font-mono text-xs text-faint">{g.replaces}</p>
                  <ul className="mt-4 space-y-2">
                    {g.items.map((it) => (
                      <li key={it} className="flex gap-2 text-sm leading-relaxed text-muted">
                        <span className="text-cyan">·</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
        </Band>

        <section id="atajos" className="scroll-mt-24 pt-24 pb-12">
          <Reveal>
            <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('shortcuts.kicker')}</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {t('shortcuts.title')}
                </h2>
                <p className="mt-3 leading-relaxed text-pretty text-muted">{t('shortcuts.lede')}</p>
              </div>
              <div className="space-y-2.5">
                {shortcutLabels.map((label, i) => (
                  <div key={label} className="flex items-center justify-between rounded-xl bg-bg/50 px-4 py-2.5">
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
          <Pricing />
          <InstallSection />
          <Faq />
        </Band>

        <section className="pt-20 pb-24">
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {stack.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-line bg-surface/40 px-4 py-1.5 font-mono text-xs text-muted transition-colors hover:border-blue/40 hover:text-fg"
                >
                  {s}
                </span>
              ))}
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
