import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'
import DownloadButton from './DownloadButton'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

type Row = { what: string; result: string; how: string }
type Item = { title: string; text: string }
type Qa = { q: string; a: string }

function ExampleFile({ format, target }: { format: string; target?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-surface2 p-3">
      <span
        aria-hidden="true"
        className="h-11 w-11 rounded-md bg-gradient-to-br from-purple/40 via-blue/30 to-cyan/30"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">Pray (W.I.P. In The Church Mix)</p>
        <p className="truncate font-mono text-xs text-faint tabular-nums">
          16-bit / 44.1 kHz · 7:08
        </p>
      </div>
      <span
        className={`rounded-md px-2 py-0.5 font-mono text-xs ${
          target ? 'bg-cyan/15 text-cyan' : 'bg-bg text-muted'
        }`}
      >
        {format}
      </span>
    </div>
  )
}

function Spectrum({
  src,
  alt,
  badge,
  good,
}: {
  src: string
  alt: string
  badge: string
  good?: boolean
}) {
  return (
    <figure className="rounded-xl bg-scrim p-3">
      <figcaption
        className={`mb-2.5 inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
          good ? 'bg-green/15 text-green' : 'bg-red/15 text-red'
        }`}
      >
        {badge}
      </figcaption>
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-md" />
    </figure>
  )
}

export default function FlacToAiff() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const keeps = t('flacToAiff.example.keeps', { returnObjects: true }) as string[]
  const rows = t('flacToAiff.carry.rows', { returnObjects: true }) as Row[]
  const reasons = t('flacToAiff.why.items', { returnObjects: true }) as Item[]
  const steps = t('flacToAiff.steps.items', { returnObjects: true }) as Item[]
  const faq = t('flacToAiff.faq.items', { returnObjects: true }) as Qa[]

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <Header page="flacToAiff" />

      <main id="main" className="relative mx-auto max-w-5xl px-6">
        <section className="grid items-center gap-10 pt-12 pb-16 sm:pt-16 lg:grid-cols-[1.1fr_1fr]">
          <Reveal eager>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('flacToAiff.h1a')} <span className="text-grad">{t('flacToAiff.h1b')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              {t('flacToAiff.lede')}
            </p>
            <div className="mt-2 flex flex-col items-start">
              <DownloadButton location="convert-hero" note={t('flacToAiff.note')} />
            </div>
          </Reveal>
          <Reveal eager delay={120}>
            <figure
              data-testid="flac-to-aiff-example"
              aria-label={t('flacToAiff.example.label')}
              className="rounded-2xl border border-line bg-surface p-4 shadow-2xl shadow-black/40 inset-shadow-edge"
            >
              <ExampleFile format="FLAC" />
              <p className="py-2 text-center font-mono text-xs text-faint">
                ↓ {t('flacToAiff.example.arrow')}
              </p>
              <ExampleFile format="AIFF" target />
              <ul className="mt-4 grid gap-x-4 gap-y-2 text-sm text-muted sm:grid-cols-2">
                {keeps.map((keep) => (
                  <li key={keep} className="flex gap-2">
                    <span aria-hidden="true" className="font-bold text-green">
                      ✓
                    </span>
                    {keep}
                  </li>
                ))}
              </ul>
            </figure>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-14">
          <Reveal>
            <Kicker>{t('flacToAiff.carry.kicker')}</Kicker>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('flacToAiff.carry.title')}
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-muted">
              {t('flacToAiff.carry.lede')}
            </p>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] tracking-wider text-faint uppercase">
                    <th className="py-3 pr-4 font-medium">{t('flacToAiff.carry.head.what')}</th>
                    <th className="hidden py-3 pr-4 font-medium sm:table-cell">
                      {t('flacToAiff.carry.head.result')}
                    </th>
                    <th className="py-3 font-medium">{t('flacToAiff.carry.head.how')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.what} className="border-b border-line/60 align-top">
                      <td className="py-3 pr-4 font-semibold sm:whitespace-nowrap">
                        {row.what}
                        <span className="mt-1 block font-mono text-xs font-normal text-green sm:hidden">
                          ✓ {row.result}
                        </span>
                      </td>
                      <td className="hidden py-3 pr-4 font-mono text-xs whitespace-nowrap text-green sm:table-cell">
                        ✓ {row.result}
                      </td>
                      <td className="py-3 leading-relaxed text-muted">{row.how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-14">
          <Reveal>
            <Kicker>{t('flacToAiff.why.kicker')}</Kicker>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('flacToAiff.why.title')}
            </h2>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              {reasons.map((reason) => (
                <div key={reason.title}>
                  <h3 className="font-semibold">{reason.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{reason.text}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-14">
          <Reveal>
            <Kicker>{t('flacToAiff.steps.kicker')}</Kicker>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('flacToAiff.steps.title')}
            </h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title} className="rounded-xl bg-surface2 p-5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-cyan font-mono text-xs font-bold text-bg">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
            <a
              href={PAGES.guide[lang]}
              className="mt-6 inline-block text-sm text-blue transition-colors hover:text-cyan"
            >
              {t('flacToAiff.steps.guide')} →
            </a>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-14">
          <Reveal>
            <Kicker>{t('flacToAiff.quality.kicker')}</Kicker>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('flacToAiff.quality.title')}
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-muted">
              {t('flacToAiff.quality.lede')}
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <Spectrum
                src="/spectrum/lossless-real.jpg"
                alt={t('home.quality.goodAlt')}
                badge={t('home.quality.goodBadge')}
                good
              />
              <Spectrum
                src="/spectrum/lossless-fake.jpg"
                alt={t('home.quality.fakeAlt')}
                badge={t('home.quality.fakeBadge')}
              />
            </div>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-14">
          <Reveal>
            <Kicker>{t('flacToAiff.faq.kicker')}</Kicker>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t('flacToAiff.faq.title')}
            </h2>
          </Reveal>
          <div className="mt-8">
            {faq.map((item) => (
              <details key={item.q} className="group border-b border-line/60 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-fg transition-colors hover:text-blue [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    className="font-mono text-lg leading-none text-blue transition-transform duration-200 group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-pretty text-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="border-t border-line/60 py-16 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('flacToAiff.outro.title')}
            </h2>
            <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
              {t('flacToAiff.outro.lede')}
            </p>
            <div className="mt-2 flex flex-col items-center text-center">
              <DownloadButton location="convert-closing" />
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
