import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'
import DownloadButton from './DownloadButton'
import Header from './Header'
import Footer from './Footer'
import { useAutoLanguage } from '../lib/useAutoLanguage'

type Section = {
  id: string
  title: string
  body: string[]
  points: string[]
  shot: string
  shotCaption: string
}

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
          <img
            src={src}
            alt={caption}
            loading="lazy"
            onError={() => setFailed(true)}
            className="block w-full"
          />
        </button>
      )}
      <figcaption className="border-t border-line/60 px-4 py-2.5 font-mono text-xs text-muted">
        {caption}
      </figcaption>
    </figure>
  )
}

// One overlay shared by every shot. It stays mounted so opening and closing are
// plain CSS transitions (interruptible, animate both ways); the last shot is
// kept while closing so the image doesn't vanish mid-fade.
function GuideLightbox({
  shot,
  open,
  onClose,
}: {
  shot: { src: string; caption: string } | null
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot?.caption}
      onClick={onClose}
      className={`fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-bg/90 p-6 backdrop-blur-md transition-[opacity,visibility] duration-200 ${
        open ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      {shot && (
        <>
          <img
            src={shot.src}
            alt={shot.caption}
            className={`max-h-[85vh] max-w-full rounded-xl border border-line transition-[scale] duration-200 ${
              open ? 'scale-100' : 'scale-[0.97]'
            }`}
          />
          <p className="max-w-xl text-center font-mono text-xs text-muted">{shot.caption}</p>
        </>
      )}
    </div>
  )
}

export default function Guide() {
  const { t } = useTranslation()
  useAutoLanguage()

  const sections = t('guide.sections', { returnObjects: true }) as Section[]
  const placeholder = t('guide.shotPlaceholder')
  const [lightboxShot, setLightboxShot] = useState<{ src: string; caption: string } | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <div id="top" className="min-h-screen bg-bg text-fg antialiased">
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <Header page="guide" />

      <main className="relative mx-auto max-w-3xl px-6">
        <section className="pt-12 pb-12 sm:pt-16">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('guide.kicker')}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{t('guide.title')}</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('guide.lede')}</p>
          </Reveal>

          <Reveal delay={120}>
            <nav className="mt-10 rounded-2xl border border-line bg-surface2/40 p-6">
              <p className="font-mono text-xs tracking-wider text-faint uppercase">{t('guide.tocLabel')}</p>
              <ol className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="group flex items-baseline gap-3 text-sm text-muted transition-colors hover:text-fg"
                    >
                      <span className="font-mono text-xs text-blue">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="transition-colors group-hover:text-fg">{s.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </Reveal>
        </section>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-20 border-t border-line/60 py-12">
            <Reveal>
              <p className="font-mono text-sm text-blue">{String(i + 1).padStart(2, '0')}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{s.title}</h2>
              {s.body.map((p) => (
                <p key={p} className="mt-4 max-w-2xl leading-relaxed text-muted">
                  {p}
                </p>
              ))}
              {s.points.length > 0 && (
                <ul className="mt-5 space-y-2.5">
                  {s.points.map((point) => (
                    <li key={point} className="flex gap-3 text-sm leading-relaxed text-muted">
                      <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
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

        <section className="border-t border-line/60 py-16 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('guide.outroTitle')}</h2>
            <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">{t('guide.outroLede')}</p>
            <div className="mt-2 flex flex-col items-center text-center">
              <DownloadButton showAnalysis={false} />
            </div>
          </Reveal>
        </section>
      </main>

      <GuideLightbox shot={lightboxShot} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />

      <Footer page="guide" />
    </div>
  )
}
