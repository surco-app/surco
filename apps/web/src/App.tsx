import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Header from './components/Header'
import Footer from './components/Footer'
import Speed from './components/Speed'
import HowItWorks from './components/HowItWorks'
import Pricing from './components/Pricing'
import Spectrogram from './components/Spectrogram'
import AppMockup from './components/AppMockup'
import Reveal from './components/Reveal'
import CountUp from './components/CountUp'
import ScrollProgress from './components/ScrollProgress'
import Tilt from './components/Tilt'
import DownloadButton from './components/DownloadButton'
import InstallSection from './components/InstallSection'
import WaveBackdrop from './components/WaveBackdrop'
import { useAutoLanguage } from './lib/useAutoLanguage'

const cardHover =
  'transition duration-200 hover:-translate-y-1 hover:border-blue/50 hover:shadow-xl hover:shadow-blue/5'

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
  const { t } = useTranslation()
  useAutoLanguage()
  const features = t('features.items', { returnObjects: true }) as {
    kick: string
    title: string
    body: string
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
    <div id="top" className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />

      <HeroGlow />

      <Header />

      <main className="relative mx-auto max-w-5xl px-6">
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
        <section className="grid items-center gap-8 pt-8 pb-24 lg:grid-cols-2 lg:gap-12 lg:pt-16">
          <div>
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
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                {t('hero.h1a')}
                <br />
                <span className="text-grad">{t('hero.h1b')}</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-pretty text-muted">
                {t('hero.ledeShort')}
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-5 font-mono text-sm text-muted">
                <span className="text-fg">AIFF</span> <span className="text-cyan">⇄</span>{' '}
                <span className="text-fg">WAV</span> <span className="text-cyan">⇄</span>{' '}
                <span className="text-fg">FLAC</span> <span className="text-cyan">⇄</span>{' '}
                <span className="text-fg">MP3</span>
              </div>
            </Reveal>
            <Reveal delay={320}>
              <DownloadButton />
            </Reveal>
          </div>

          <Reveal delay={200}>
            <Tilt>
              <AppMockup />
            </Tilt>
          </Reveal>
        </section>

        <Speed />

        <Reveal>
          <section className="pb-24">
            <div className="inset-shadow-edge grid gap-8 rounded-3xl border border-line bg-surface2/40 p-8 text-center sm:grid-cols-3 sm:p-10">
              <div>
                <div className="text-4xl font-bold text-grad tabular-nums sm:text-5xl">
                  ~<CountUp to={100} />×
                </div>
                <p className="mt-2 text-sm text-muted">{t('stats.faster')}</p>
              </div>
              <div>
                <div className="text-4xl font-bold text-fg tabular-nums sm:text-5xl">1–2 s</div>
                <p className="mt-2 text-sm text-muted">{t('stats.perTrack')}</p>
              </div>
              <div>
                <div className="text-4xl font-bold text-fg sm:text-5xl">1</div>
                <p className="mt-2 text-sm text-muted">{t('stats.oneShot')}</p>
              </div>
            </div>
          </section>
        </Reveal>

        <HowItWorks />

        <section id="analisis" className="scroll-mt-24 pb-24">
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

        <section id="funciones" className="scroll-mt-24 pb-24">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('features.kicker')}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('features.title')}
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 100}>
                <div className={`inset-shadow-edge h-full rounded-2xl border border-line bg-surface2/40 p-6 ${cardHover}`}>
                  <div className="font-mono text-xs text-blue">{f.kick}</div>
                  <h3 className="mt-2 text-lg font-semibold text-fg">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="atajos" className="scroll-mt-24 pb-24">
          <Reveal>
            <div className="inset-shadow-edge grid gap-8 rounded-3xl border border-line bg-surface2/40 p-8 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
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

        <div className="relative">
          <WaveBackdrop />
          <Pricing />
          <InstallSection />
        </div>

        <section className="pb-24">
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
