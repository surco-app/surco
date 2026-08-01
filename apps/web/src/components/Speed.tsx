import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MANUAL_STEPS, raceFrame, RACE_END, TRACKS, type RaceFrame } from '../lib/race'
import Kicker from './Kicker'
import Reveal from './Reveal'

const TIMES = MANUAL_STEPS.map((s) => `~${s.seconds} s`)

// Long enough to read the two lanes diverge, short enough that nobody scrolls past
// mid-run. The manual job is three hours of work replayed into this window.
const DURATION_MS = 14000

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const hhmm = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

// Drives the section from one pure raceFrame(t), so replay, the end state and the
// reduced-motion jump are the same code path with a different t. The old version ran
// on CSS keyframes that started at mount: by the time the section scrolled into view
// the race could already be over, and reduced motion left it frozen at zero.
function useRace(): { frame: RaceFrame; replay: () => void; started: boolean } {
  const [frame, setFrame] = useState(() => raceFrame(0))
  const [started, setStarted] = useState(false)
  const raf = useRef(0)

  const run = useCallback(() => {
    cancelAnimationFrame(raf.current)
    setStarted(true)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFrame(raceFrame(RACE_END))
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS)
      setFrame(raceFrame(p * RACE_END))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return { frame, replay: run, started }
}

// The grid is a fixed row of slots, never reordered or filtered — slot n is track n
// on both sides — so each cell's identity is its position.
const CELLS = Array.from({ length: TRACKS }, (_, i) => `track-${i + 1}`)

// Forty cells, one per track, on both sides. This is where the comparison is legible
// at a glance: the two grids fill at wildly different rates while the numbers above
// them agree on what is being counted.
function TrackGrid({
  done,
  tone,
  total,
  ready,
}: {
  done: number
  tone: 'slow' | 'fast'
  total: string
  ready: string
}) {
  return (
    <div className="relative mt-4">
      <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] text-faint">
        <span>{total}</span>
        <span className={`tabular-nums ${tone === 'fast' ? 'text-cyan' : 'text-red'}`}>
          {done} {ready}
        </span>
      </div>
      <div className="grid grid-cols-20 gap-1">
        {CELLS.map((cell, i) => (
          <div
            key={cell}
            className={`aspect-square rounded-[3px] transition-colors duration-300 ${
              i < done ? (tone === 'fast' ? 'bg-cyan' : 'bg-red') : 'bg-surface2'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

export default function Speed() {
  const { t } = useTranslation()
  const { frame, replay, started } = useRace()
  const sectionRef = useRef<HTMLDivElement>(null)

  // Start when the cards are actually on screen, not at mount.
  useEffect(() => {
    const el = sectionRef.current
    if (!el || started) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        replay()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [replay, started])

  const manualSteps = t('speed.manualSteps', { returnObjects: true }) as {
    app: string
    label: string
  }[]
  const bullets = t('speed.bullets', { returnObjects: true }) as string[]

  return (
    <section id="velocidad" className="scroll-mt-24 pt-24 pb-24">
      <Reveal>
        <Kicker>{t('speed.kicker')}</Kicker>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('speed.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('speed.lede')}</p>
      </Reveal>

      <div ref={sectionRef} className="mt-10 grid items-stretch gap-5 md:grid-cols-2">
        <Reveal>
          <div className="inset-shadow-edge h-full rounded-2xl border border-line bg-surface2/40 p-6">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-fg">{t('speed.manual')}</span>
              <span className="font-mono text-sm text-red tabular-nums">
                {hhmm(frame.manualSeconds)}
              </span>
            </div>
            <ul className="mt-4 space-y-2.5">
              {manualSteps.map((s, i) => {
                const batch = MANUAL_STEPS[i].per === 'batch'
                return (
                  <li
                    key={s.label}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-300 ${
                      // A dashed edge says "this one runs once for the whole folder"
                      // without needing a legend; the per-track rows keep the solid fill
                      // and take the highlight as the run walks them.
                      batch
                        ? 'border border-dashed border-line'
                        : frame.activeStep === i
                          ? 'bg-red/10'
                          : 'bg-bg/50'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-faint">{TIMES[i]}</span>
                    <span className={`text-sm ${frame.doneSteps[i] ? 'text-muted' : 'text-fg'}`}>
                      {s.label}
                    </span>
                    {frame.doneSteps[i] && <span className="text-[10px] text-green">✓</span>}
                    <span className="ml-auto font-mono text-[10px] text-faint">{s.app}</span>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-red/70"
                style={{ width: `${(frame.manualDone / TRACKS) * 100}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">{t('speed.manualCaption')}</p>
            <TrackGrid
              done={frame.manualDone}
              tone="slow"
              total={t('speed.trackCount', { count: TRACKS })}
              ready={t('speed.tracksReady')}
            />
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="inset-shadow-edge relative h-full overflow-hidden rounded-2xl border border-blue/40 bg-surface2/40 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue/5">
            {/* Static bloom. It used to pulse on a 4s loop, which put a 192px blur-2xl layer
                on a permanent repaint for an effect nobody watches — the small blue dots
                elsewhere pulse because they report live status, whereas this is scenery, and
                the section's actual motion is the race bars below it. */}
            <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl" />
            <div className="relative flex items-baseline justify-between">
              <span className="text-sm font-semibold text-fg">{t('speed.withSurco')}</span>
              <span className="font-mono text-sm text-cyan tabular-nums">
                {mmss(frame.surcoSeconds)}
              </span>
            </div>
            <div className="relative mt-4 flex items-center gap-3 rounded-xl border border-blue/40 bg-blue/10 px-4 py-3">
              <span className="font-mono text-xs text-blue">▶</span>
              <span className="text-sm font-medium text-fg">{t('speed.combo')}</span>
              <span
                className={`ml-auto text-green transition-opacity duration-200 ${
                  frame.surcoDone >= TRACKS ? 'opacity-100' : 'opacity-0'
                }`}
              >
                ✓
              </span>
            </div>
            <ul className="relative mt-4 space-y-1.5 text-sm text-muted">
              {bullets.map((b) => (
                <li key={b} className="flex gap-2.5">
                  <span className="text-cyan">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
                style={{ width: `${(frame.surcoDone / TRACKS) * 100}%` }}
              />
            </div>
            <p className="relative mt-2 font-mono text-[10px] text-faint">{t('speed.oneClick')}</p>
            <TrackGrid
              done={frame.surcoDone}
              tone="fast"
              total={t('speed.trackCount', { count: TRACKS })}
              ready={t('speed.tracksReady')}
            />
          </div>
        </Reveal>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={replay}
          className="press rounded-lg border border-line bg-surface2/60 px-3 py-1.5 font-mono text-xs text-muted hover:border-blue/40 hover:text-fg"
        >
          {t('speed.replay')}
        </button>
        <p className="font-mono text-[11px] text-faint">{t('speed.footnote')}</p>
      </div>
    </section>
  )
}
