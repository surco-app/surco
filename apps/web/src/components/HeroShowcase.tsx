import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cameraTransform, type Frame } from '../lib/heroCamera'
import Lightbox from './Lightbox'

// Feature showcase over the hero screenshot: a side list of the app's features
// and a "camera" that pans/zooms the screenshot to the one the visitor clicks.
// At rest the full screenshot shows; clicking the active feature again returns
// to the full view.
type Feature = { id: string; frame: Frame }

const FEATURES: Feature[] = [
  { id: 'tracks', frame: { top: 5, left: 0.5, width: 22, height: 70 } },
  { id: 'discogs', frame: { top: 5, left: 21.5, width: 26, height: 60 } },
  { id: 'metadata', frame: { top: 5, left: 47.5, width: 51, height: 53 } },
  { id: 'quality', frame: { top: 60, left: 47.5, width: 51, height: 32 } },
  { id: 'convert', frame: { top: 78, left: 47.5, width: 51, height: 21 } },
]

export default function HeroShowcase() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const src = `/app-${lang}.webp`
  const srcSet = `/app-${lang}-1024.webp 1024w, /app-${lang}.webp 2000w`

  const [active, setActive] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)

  const select = (id: string) => setActive((current) => (current === id ? null : id))

  const frame = FEATURES.find((f) => f.id === active)?.frame ?? null
  const { scale, x, y } = cameraTransform(frame)

  return (
    <figure className="relative mx-auto max-w-6xl">
      <div
        className="pointer-events-none absolute -inset-x-6 -top-10 bottom-10 -z-10"
        style={{
          background:
            'radial-gradient(50% 55% at 50% 0%, rgba(122,162,247,0.22) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-center">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('showcase.alt')}
          className="order-2 flex flex-col gap-1.5 lg:order-1"
        >
          {FEATURES.map((f, i) => {
            const isActive = active === f.id
            return (
              <button
                key={f.id}
                id={`hero-showcase-tab-${f.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="hero-showcase-panel"
                onClick={() => select(f.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors duration-300 ${
                  isActive
                    ? 'border-line bg-bg2'
                    : 'border-transparent text-muted hover:bg-bg2/50 hover:text-fg'
                } focus:outline-none focus-visible:ring-2 focus-visible:ring-blue`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-colors duration-300 ${
                      isActive ? 'bg-blue text-bg' : 'border border-line text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className={`font-semibold ${isActive ? 'text-fg' : ''}`}>
                    {t(`showcase.tour.${f.id}.title`)}
                  </span>
                </span>
                {isActive && (
                  <span className="mt-2 block text-sm leading-relaxed text-muted">
                    {t(`showcase.tour.${f.id}.desc`)}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id="hero-showcase-panel"
          aria-labelledby={active ? `hero-showcase-tab-${active}` : undefined}
          className="relative order-1 overflow-hidden rounded-2xl border border-line bg-bg2 shadow-2xl shadow-black/60 ring-1 ring-white/5 lg:order-2"
        >
          <img
            src={src}
            srcSet={srcSet}
            sizes="(min-width: 1200px) 1600px, calc((100vw - 48px) * 2.2)"
            alt={t('showcase.alt')}
            width={2000}
            height={1242}
            fetchPriority="high"
            decoding="async"
            className="block w-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
            style={{ transform: `scale(${scale}) translate(${x}%, ${y}%)`, transformOrigin: '0 0' }}
          />

          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={t('showcase.zoom')}
            className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-lg border border-white/15 bg-bg/60 text-fg backdrop-blur transition hover:border-blue/60 hover:text-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-blue"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      <Lightbox
        open={zoomed}
        src={src}
        alt={t('showcase.alt')}
        closeLabel={t('lightbox.close')}
        onClose={() => setZoomed(false)}
      />
    </figure>
  )
}
