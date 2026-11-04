import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DownloadButton from './DownloadButton'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Lightbox from './Lightbox'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

type Section = {
  id: string
  group: string
  title: string
  s: string
  body: string[]
  steps: { lead: string; text: string }[]
  points: string[]
  shot: string
  shotCaption: string
}

// The export size every walkthrough shot shares: 2x the ~718px the figure is ever painted
// at, which is what a retina screen actually draws and no more.
const SHOT_WIDTH = 1440
const SHOT_HEIGHT = 895

// Renders a screenshot/GIF for a step. The images live in /public/guide and are
// dropped in after the fact, so a missing file falls back to a labelled
// placeholder instead of a broken image — the page reads fine before the media
// lands.
function GuideShot({
  src,
  caption,
  placeholder,
  onZoom,
}: {
  src: string
  caption: string
  placeholder: string
  onZoom: (shot: { src: string; caption: string }) => void
}) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="mt-7 overflow-hidden rounded-2xl border border-line bg-surface2/40">
      {failed ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 text-center">
          <span className="rounded-full border border-line bg-bg/60 px-3 py-1 font-mono text-[11px] text-faint">
            {placeholder}
          </span>
          <span className="max-w-xs px-6 text-xs text-muted">{caption}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onZoom({ src, caption })}
          className="block w-full cursor-zoom-in"
        >
          {/* Every walkthrough shot is exported at this size, so declaring it lets the
              browser reserve the figure's height from the aspect ratio before the file
              arrives. Without it each lazy image resolved from zero-height and shoved the
              text the reader was following down the page — nineteen times per visit. */}
          <img
            src={src}
            alt={caption}
            width={SHOT_WIDTH}
            height={SHOT_HEIGHT}
            loading="lazy"
            onError={() => setFailed(true)}
            className="block h-auto w-full"
          />
        </button>
      )}
      <figcaption className="border-t border-line/60 px-4 py-2.5 text-sm text-muted">
        {caption}
      </figcaption>
    </figure>
  )
}

export default function Guide() {
  const { t } = useTranslation()

  const sections = t('guide.sections', { returnObjects: true }) as Section[]
  const groups = t('guide.groups', { returnObjects: true }) as { id: string; title: string }[]
  const blocks = groups.map((g) => ({
    ...g,
    items: sections
      .map((s, i) => ({ s, n: String(i + 1).padStart(2, '0') }))
      .filter(({ s }) => s.group === g.id),
  }))
  const placeholder = t('guide.shotPlaceholder')
  const [lightboxShot, setLightboxShot] = useState<{ src: string; caption: string } | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <div id="top" className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />

      <Header page="guide" />

      <main
        id="main"
        className="relative mx-auto max-w-3xl px-6 sm:px-10 lg:grid lg:max-w-6xl lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16"
      >
        <aside className="hidden lg:block">
          <nav
            data-testid="guide-side-toc"
            aria-label={t('guide.tocLabel')}
            className="sticky top-24 mt-16 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2"
          >
            <p className="text-sm font-medium text-faint">{t('guide.tocLabel')}</p>
            <ol className="mt-3 space-y-4">
              {blocks.map((b) => (
                <li key={b.id}>
                  <p className="text-xs font-medium text-subtle">{b.title}</p>
                  <ol className="mt-1.5 space-y-1.5">
                    {b.items.map(({ s, n }) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className="flex items-baseline gap-2.5 text-[13px] leading-snug text-muted transition-colors hover:text-fg"
                        >
                          <span className="font-mono text-[11px] text-blue">{n}</span>
                          <span>{s.title}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 max-w-3xl">
          {/* pb smaller than pt: each section below brings its own py-12, so the
            index used to sit in about 150px of empty background. */}
          <section className="pt-12 pb-4 sm:pt-16">
            <Reveal eager>
              <Kicker>{t('guide.kicker')}</Kicker>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
                {t('guide.title')}
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('guide.lede')}</p>
            </Reveal>

            <Reveal eager delay={120}>
              <nav className="mt-10 rounded-2xl border border-line bg-surface2/40 p-6 lg:hidden">
                <p className="text-sm font-medium text-faint">{t('guide.tocLabel')}</p>
                <ol className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  {blocks.map((b) => (
                    <li key={b.id}>
                      <p className="text-xs font-medium text-subtle">{b.title}</p>
                      <ol className="mt-2 space-y-2.5">
                        {b.items.map(({ s, n }) => (
                          <li key={s.id}>
                            <a
                              href={`#${s.id}`}
                              className="group flex items-baseline gap-3 text-sm text-muted transition-colors hover:text-fg"
                            >
                              <span className="font-mono text-xs text-blue">{n}</span>
                              <span className="transition-colors group-hover:text-fg">
                                {s.title}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ol>
              </nav>
            </Reveal>
          </section>

          {blocks.map((b) => (
            <div key={b.id} data-testid="guide-block">
              <h2 className="mt-12 border-t border-line pt-6 text-lg font-semibold text-fg">
                {b.title}
              </h2>
              {b.items.map(({ s, n }) => (
                <section key={s.id} id={s.id} className="scroll-mt-20 py-14 sm:py-16">
                  <Reveal>
                    <p className="font-mono text-sm text-blue">{n}</p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                      {s.title}
                    </h3>
                    <p className="mt-3 max-w-2xl text-lg leading-snug text-pretty text-subtle">
                      {s.s}
                    </p>
                    {s.body.map((p) => (
                      <p key={p} className="mt-4 max-w-2xl leading-relaxed text-muted">
                        {p}
                      </p>
                    ))}
                    <ol data-testid="guide-steps" className="mt-6 space-y-3">
                      {s.steps.map((step, n) => (
                        <li key={step.lead} className="flex gap-3.5 leading-relaxed text-muted">
                          <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border border-line font-mono text-xs text-blue">
                            {n + 1}
                          </span>
                          <span>
                            <strong className="font-semibold text-fg">{step.lead}</strong>{' '}
                            {step.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {s.points.length > 0 && (
                      <details
                        data-testid="guide-notes"
                        className="mt-6 rounded-xl border border-line bg-surface2/40"
                      >
                        <summary className="cursor-pointer px-4 py-3 text-sm text-subtle">
                          {t('guide.notesLabel')}
                        </summary>
                        <ul className="space-y-2.5 px-4 pb-4">
                          {s.points.map((point) => (
                            <li
                              key={point}
                              className="flex gap-3 text-sm leading-relaxed text-muted"
                            >
                              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {s.shot && (
                      <GuideShot
                        src={`/guide/${s.shot}`}
                        caption={s.shotCaption}
                        placeholder={placeholder}
                        onZoom={(shot) => {
                          setLightboxShot(shot)
                          setLightboxOpen(true)
                        }}
                      />
                    )}
                  </Reveal>
                </section>
              ))}
            </div>
          ))}

          <section className="py-20 text-center sm:py-24">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {t('guide.outroTitle')}
              </h2>
              <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
                {t('guide.outroLede')}
              </p>
              <div className="mt-2 flex flex-col items-center text-center">
                <DownloadButton location="guide" />
              </div>
            </Reveal>
          </section>
        </div>
      </main>

      <Lightbox
        open={lightboxOpen}
        src={lightboxShot?.src ?? null}
        alt={lightboxShot?.caption ?? ''}
        caption={lightboxShot?.caption}
        closeLabel={t('lightbox.close')}
        onClose={() => setLightboxOpen(false)}
      />

      <Footer />
    </div>
  )
}
