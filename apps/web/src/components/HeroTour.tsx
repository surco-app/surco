import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Lightbox from './Lightbox'

// Interactive tour over the hero screenshot. Each region is a marker the visitor
// can hover, tap, or focus — activating it spotlights that part of the app (dims
// the rest) and shows an explainer card anchored to the marker. Coordinates are
// percentages so they ride the responsive `srcset` at any width.
type Region = {
  id: string
  top: number
  left: number
  width: number
  height: number
  dot: { top: number; left: number }
}

const REGIONS: Region[] = [
  { id: 'tracks', top: 5, left: 0.5, width: 22, height: 92, dot: { top: 30, left: 11.5 } },
  { id: 'discogs', top: 5, left: 21.5, width: 26, height: 92, dot: { top: 31, left: 34.5 } },
  { id: 'metadata', top: 5, left: 47.5, width: 51, height: 53, dot: { top: 26, left: 72 } },
  { id: 'quality', top: 68, left: 47.5, width: 51, height: 24, dot: { top: 82, left: 72 } },
  { id: 'convert', top: 92, left: 47.5, width: 51, height: 7, dot: { top: 95.5, left: 72 } },
]

// Slow ease-out so the spotlight and card glide rather than snap between regions.
const EASE = 'transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'

export default function HeroTour() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const src = `/app-${lang}.webp`
  const srcSet = `/app-${lang}-1024.webp 1024w, /app-${lang}.webp 2000w`

  // `active` drives the highlight; `displayId` lags it so the spotlight and card
  // keep the last region's position/content while fading out (no jump-to-corner).
  const [active, setActive] = useState<string | null>(null)
  const [displayId, setDisplayId] = useState('tracks')
  const [zoomed, setZoomed] = useState(false)

  const show = (id: string) => {
    setActive(id)
    setDisplayId(id)
  }
  const region = REGIONS.find((r) => r.id === displayId) as Region
  const index = REGIONS.findIndex((r) => r.id === displayId)
  // Card hangs below its marker, or above it for the markers near the bottom edge.
  const below = region.dot.top < 70

  return (
    <figure className="relative mx-auto max-w-6xl">
      <div
        className="pointer-events-none absolute -inset-x-6 -top-10 bottom-10 -z-10"
        style={{
          background:
            'radial-gradient(50% 55% at 50% 0%, rgba(122,162,247,0.22) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only affordance that clears the active hotspot on mouse leave; the hotspots themselves are buttons, so there's no keyboard equivalent to add */}
      <div
        className="group relative overflow-hidden rounded-2xl border border-line bg-bg2 shadow-2xl shadow-black/60 ring-1 ring-white/5"
        onMouseLeave={() => setActive(null)}
      >
        <img
          src={src}
          srcSet={srcSet}
          sizes="(min-width: 1200px) 1152px, calc(100vw - 48px)"
          alt={t('showcase.alt')}
          width={2000}
          height={1242}
          fetchPriority="high"
          decoding="async"
          className="block w-full"
        />

        {/* Spotlight: a ring around the active region whose huge box-shadow dims
            everything else. Stays mounted so position/dim glide between regions. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-xl ${EASE}`}
          style={{
            top: `${region.top}%`,
            left: `${region.left}%`,
            width: `${region.width}%`,
            height: `${region.height}%`,
            opacity: active ? 1 : 0,
            // No border at all — the region reads purely by contrast: full
            // brightness inside, a feathered dim everything else. The blurred
            // edge keeps it from looking like a hard rectangular cut.
            boxShadow: `0 0 22px 9999px rgba(13,13,18,${active ? 0.62 : 0})`,
            willChange: 'top, left, width, height',
          }}
        />

        {REGIONS.map((r, i) => (
          <button
            key={r.id}
            type="button"
            aria-label={t(`showcase.tour.${r.id}.title`)}
            onMouseEnter={() => show(r.id)}
            onFocus={() => show(r.id)}
            onClick={() => (active === r.id ? setActive(null) : show(r.id))}
            style={{ top: `${r.dot.top}%`, left: `${r.dot.left}%` }}
            className={`absolute z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-xs backdrop-blur transition-all duration-300 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue ${
              active === r.id
                ? 'scale-110 border-blue bg-blue text-bg opacity-100'
                : active
                  ? 'border-white/20 bg-bg/60 text-muted opacity-30 hover:scale-110 hover:border-blue/70 hover:opacity-100'
                  : 'border-white/30 bg-bg/70 text-fg opacity-0 group-hover:opacity-100 hover:scale-110 hover:border-blue/70 pointer-coarse:opacity-100'
            }`}
          >
            {!active && (
              <span className="absolute inline-flex size-8 animate-ping rounded-full bg-blue/30 motion-reduce:hidden" />
            )}
            <span className="relative">{i + 1}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={t('showcase.zoom')}
          className="absolute top-3 right-3 z-30 flex size-9 items-center justify-center rounded-lg border border-white/15 bg-bg/60 text-fg backdrop-blur transition hover:border-blue/60 hover:text-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-blue"
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

        {/* Explainer card, anchored just below (or above) the active marker so it
            reads as attached to that section. Clamped horizontally to stay in frame. */}
        <div
          style={{
            top: `${region.dot.top}%`,
            left: `${Math.min(Math.max(region.dot.left, 18), 82)}%`,
            transform: `translate(-50%, ${below ? '26px' : 'calc(-100% - 26px)'})`,
            opacity: active ? 1 : 0,
          }}
          className={`absolute z-20 w-[min(20rem,78vw)] ${EASE} ${active ? '' : 'pointer-events-none'}`}
        >
          <div className="rounded-xl border border-line bg-bg/90 p-4 shadow-xl backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-blue font-mono text-[11px] font-semibold text-bg">
                {index + 1}
              </span>
              <span className="font-semibold text-fg">{t(`showcase.tour.${region.id}.title`)}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t(`showcase.tour.${region.id}.desc`)}
            </p>
          </div>
        </div>

        <div
          className={`pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-line bg-bg/70 px-3 py-1 font-mono text-[11px] text-muted backdrop-blur transition-opacity duration-300 ${
            active ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {t('showcase.tourHint')}
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
