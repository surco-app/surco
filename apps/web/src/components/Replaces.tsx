import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import CountUp from './CountUp'
import Reveal from './Reveal'

// One generic, monochrome glyph per replaced program, in the same order as the
// `replaces.apps` i18n list (names are translated, so the mapping is by index, not text).
// Deliberately generic — no third-party brand logos.
const ICONS: ReactNode[] = [
  // Converter — the repeat/convert arrows
  <>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </>,
  // Discogs — a record
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
  // Tag editor — a tag
  <>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h6l9 9-6 6-9-9v-4.5Z" />
    <circle cx="7.5" cy="9.5" r="1" />
  </>,
  // Spek — a spectrum
  <>
    <line x1="6" y1="14" x2="6" y2="18" />
    <line x1="10" y1="9" x2="10" y2="18" />
    <line x1="14" y1="5" x2="14" y2="18" />
    <line x1="18" y1="11" x2="18" y2="18" />
  </>,
  // Apple Music — a music note
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>,
]

export default function Replaces() {
  const { t } = useTranslation()
  const apps = t('replaces.apps', { returnObjects: true }) as string[]

  return (
    <section id="reemplaza" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('replaces.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('replaces.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('replaces.lede')}</p>
      </Reveal>

      <div className="mt-10 grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
        {/* Each program crosses itself off in sequence once the list scrolls in (the
            cascade is driven by --i + the .reveal-in gate in index.css). */}
        <Reveal from="left">
          <ul className="grid gap-2.5">
            {apps.map((a, i) => (
              <li
                key={a}
                className="replace-pill flex items-center gap-2.5 rounded-xl border border-line bg-surface2/30 px-4 py-2.5"
                style={{ '--i': i } as CSSProperties}
              >
                <svg
                  className="size-4 shrink-0 text-faint"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONS[i]}
                </svg>
                <span className="relative text-sm text-muted">
                  {a}
                  <span
                    className="replace-strike pointer-events-none absolute inset-x-0 top-1/2 h-px bg-red/70"
                    aria-hidden="true"
                  />
                </span>
                <span className="ml-auto font-mono text-xs text-red/70" aria-hidden="true">
                  ✕
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="flex items-center justify-center" aria-hidden="true">
          <span className="rotate-90 font-mono text-3xl text-cyan md:rotate-0">→</span>
        </div>

        <Reveal from="right" delay={120}>
          <div className="inset-shadow-edge relative overflow-hidden rounded-2xl border border-blue/40 bg-surface2/40 p-6">
            <div
              className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl"
              style={{ animation: 'glow 4s ease-in-out infinite' }}
            />
            <div className="relative text-3xl font-bold text-grad">Surco</div>
            <p className="relative mt-1 text-sm text-muted">{t('replaces.result')}</p>
            <div className="relative mt-6 flex gap-8">
              <div>
                <div className="text-3xl font-bold text-fg tabular-nums">
                  ~<CountUp to={100} />×
                </div>
                <p className="mt-1 text-xs text-muted">{t('replaces.faster')}</p>
              </div>
              <div>
                <div className="text-3xl font-bold text-fg tabular-nums">1–2 s</div>
                <p className="mt-1 text-xs text-muted">{t('replaces.perTrack')}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
