import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TAG_MATCHES, TAG_TOTAL, tagFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'
import CoverArt from './CoverArt'

// The whole act, in order: the query types itself, releases arrive one by one, one
// gets picked, and the artwork and fields land as its consequence. The previous
// version opened on results already listed and panels already resolved — the outcome
// of a click the visitor never saw, with a before/after floating free of any file.
export default function TagScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const progress = useSceneProgress(ref, 6400)
  const frame = tagFrame(progress)
  const done = progress >= 1

  const fieldLabels = [
    t('home.tag.fields.label'),
    t('home.tag.fields.bpm'),
    t('home.tag.fields.key'),
    t('home.tag.fields.year'),
  ]

  return (
    <AppFrame
      pill={`${frame.done}/${TAG_TOTAL}`}
      busy={!done}
      progress={(frame.done / TAG_TOTAL) * 100}
    >
      <div ref={ref} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {/* The search field, typing itself. Without it the results are a list that
              was always there, and "in one click" has no click to point at. */}
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-2 py-1.5 font-mono text-[11px]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className="size-3 shrink-0 text-faint"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-fg/90">
              {frame.query}
              {!frame.picked && (
                <span
                  aria-hidden="true"
                  className="ml-px inline-block h-3 w-px translate-y-0.5 bg-blue"
                  style={{ animation: 'glow 1s steps(2) infinite' }}
                />
              )}
            </span>
          </div>

          <div className="space-y-1.5">
            {TAG_MATCHES.map((r, i) => {
              const shown = i < frame.results
              const active = frame.picked ? i === 0 : frame.activeRow === i
              return (
                <div
                  key={r.src}
                  className={`flex items-center gap-2 rounded-lg border p-2 font-mono text-[11px] transition-all duration-300 ${
                    shown
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-1 opacity-0'
                  } ${active ? 'border-blue/45 bg-blue/10' : 'border-line'}`}
                >
                  {i === 0 ? (
                    <CoverArt className="size-7 shrink-0 rounded" />
                  ) : (
                    <span className="size-7 shrink-0 rounded bg-surface" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg/90">{r.title}</span>
                    <span className="block truncate text-[10px] text-faint">{r.meta}</span>
                  </span>
                  {frame.picked && i === 0 ? (
                    <span className="shrink-0 rounded-full bg-blue px-1.5 text-[9px] text-bg">
                      {t('home.tag.applied')}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-line px-1.5 text-[9px] text-faint">
                      {r.src}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2 font-mono text-[11px]">
          {/* Artwork and artist side by side: the cover landing is what says a release
              was applied, where a name alone reads as a field someone typed. */}
          <div className="flex gap-2">
            <div className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-line bg-bg/60">
              <div
                className="size-full"
                style={{
                  opacity: frame.artwork,
                  transform: `scale(${0.92 + frame.artwork * 0.08})`,
                }}
              >
                <CoverArt className="size-full" />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="rounded-lg border border-red/45 bg-bg/60 p-2">
                <span className="block text-[9px] tracking-wider text-faint uppercase">
                  {t('home.tag.before')}
                </span>
                <span className="mt-1 block truncate text-red">2-2-2c-2e-1-2c-2e-1-2y4c-EF</span>
              </div>
              <div className="flex-1 rounded-lg border border-green/45 bg-bg/60 p-2">
                <span className="block text-[9px] tracking-wider text-faint uppercase">
                  {t('home.tag.after')}
                </span>
                <span className="mt-1 block min-h-4 text-green">{frame.artist}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {fieldLabels.map((k, i) => (
              <div key={k} className="rounded-lg border border-line bg-bg/60 p-2">
                <span className="block text-[9px] tracking-wider text-faint uppercase">{k}</span>
                <span className="mt-1 block min-h-4 truncate text-fg/90">{frame.fields[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  )
}
