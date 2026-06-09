import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'
import DownloadButton from './DownloadButton'
import { useAutoLanguage, rememberLanguage } from '../lib/useAutoLanguage'

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
}: {
  src: string
  caption: string
  placeholder: string
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
        <img
          src={src}
          alt={caption}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block w-full"
        />
      )}
      <figcaption className="border-t border-line/60 px-4 py-2.5 font-mono text-xs text-muted">
        {caption}
      </figcaption>
    </figure>
  )
}

export default function Guide() {
  const { t, i18n } = useTranslation()
  useAutoLanguage()

  const sections = t('guide.sections', { returnObjects: true }) as Section[]
  const home = i18n.language === 'en' ? '/en' : '/'
  const otherGuide = i18n.language === 'en' ? '/guia' : '/en/guide'
  const otherLabel = i18n.language === 'en' ? 'ES' : 'EN'
  const otherCode = i18n.language === 'en' ? 'es' : 'en'
  const placeholder = t('guide.shotPlaceholder')

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

      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <a href={home} className="flex items-center gap-2.5">
            <img src="/icon.png" alt="Surco" className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Surco</span>
          </a>
          <div className="flex items-center gap-4">
            <a
              href={home}
              className="text-sm text-muted transition-colors hover:text-fg"
            >
              {t('guide.back')}
            </a>
            <a
              href={otherGuide}
              onClick={() => rememberLanguage(otherCode)}
              className="inline-flex items-center rounded-full border border-line px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-blue/50 hover:text-fg"
            >
              {otherLabel}
            </a>
          </div>
        </div>
      </header>

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
                <GuideShot src={`/guide/${s.shot}`} caption={s.shotCaption} placeholder={placeholder} />
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

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-faint sm:flex-row">
          <a href={home} className="transition-colors hover:text-fg">
            {t('guide.back')}
          </a>
          <span>{t('footer.copyright')}</span>
        </div>
      </footer>
    </div>
  )
}
