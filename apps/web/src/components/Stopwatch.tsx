import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NORMALIZE_BEFORE_MS,
  NORMALIZE_WARM_MS,
  OPS,
  STOPWATCH_END,
  type StopwatchFrame,
  stopwatchFrame,
} from '../lib/stopwatch'
import Kicker from './Kicker'
import Reveal from './Reveal'

const seconds = (ms: number, digits: number, lng: string) =>
  (ms / 1000).toLocaleString(lng, { minimumFractionDigits: digits, maximumFractionDigits: digits })

// Under a second the row reads in milliseconds, which is the unit that makes the
// point; from a second up, seconds with two decimals.
const rowTime = (ms: number, lng: string, msUnit: string, sUnit: string) =>
  ms < 1000 ? `${ms} ${msUnit}` : `${seconds(ms, 2, lng)} ${sUnit}`

// Drives the board from one pure stopwatchFrame(t), like the race in Speed: the
// replay, the end state and the reduced-motion jump are the same code path with a
// different t. The clock here is real elapsed time, not a scaled one.
function useStopwatch(): { frame: StopwatchFrame; replay: () => void; started: boolean } {
  const [frame, setFrame] = useState(() => stopwatchFrame(0))
  const [started, setStarted] = useState(false)
  const raf = useRef(0)

  const run = useCallback(() => {
    cancelAnimationFrame(raf.current)
    setStarted(true)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFrame(stopwatchFrame(STOPWATCH_END))
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = now - start
      setFrame(stopwatchFrame(t))
      if (t < STOPWATCH_END) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return { frame, replay: run, started }
}

export default function Stopwatch() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { frame, replay, started } = useStopwatch()
  const boardRef = useRef<HTMLDivElement>(null)

  // Start when the board is actually on screen, not at mount: a stopwatch that ran
  // while the reader was still up in the hero would be over before anyone saw it.
  useEffect(() => {
    const el = boardRef.current
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

  const ops = t('stopwatch.ops', { returnObjects: true }) as Record<
    string,
    { label: string; detail: string }
  >
  const tiles = t('stopwatch.tiles', { returnObjects: true }) as {
    big: string
    label: string
    how: string
  }[]
  const msUnit = t('stopwatch.ms')
  const sUnit = t('stopwatch.s')

  return (
    <section id="cronometro" className="scroll-mt-24 pt-12 pb-24">
      <Reveal>
        <Kicker>{t('stopwatch.kicker')}</Kicker>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('stopwatch.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
          {t('stopwatch.lede')}
        </p>
      </Reveal>

      <Reveal>
        <div
          ref={boardRef}
          data-testid="stopwatch-board"
          className="inset-shadow-edge mt-10 overflow-hidden rounded-2xl border border-line bg-surface2/40"
        >
          <div className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="text-sm font-semibold text-fg">
              {t('stopwatch.board')}
              <span className="ml-2.5 font-mono text-[11px] font-normal text-faint">
                {t('stopwatch.boardSpec')}
              </span>
            </div>
            <div
              className="font-mono text-2xl text-cyan tabular-nums sm:text-3xl"
              data-testid="stopwatch-clock"
            >
              {seconds(frame.elapsedMs, 3, lng)}
              <span className="ml-1.5 text-xs text-faint">{sUnit}</span>
            </div>
          </div>
          <ul>
            {OPS.map((op, i) => {
              const row = frame.rows[i]
              const copy = ops[op.key]
              return (
                <li
                  key={op.key}
                  data-testid={`stopwatch-row-${op.key}`}
                  data-state={row.done ? 'done' : row.running ? 'running' : 'idle'}
                  className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_96px] sm:px-6"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-fg">{copy.label}</div>
                    <div className="truncate font-mono text-[11px] text-faint">{copy.detail}</div>
                  </div>
                  <div className="relative order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-bg sm:order-none sm:col-span-1">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${
                        row.done
                          ? 'bg-gradient-to-r from-blue to-green'
                          : 'bg-gradient-to-r from-blue to-cyan'
                      }`}
                      style={{ width: `${row.progress * 100}%` }}
                    />
                  </div>
                  <div
                    className={`text-right font-mono text-sm tabular-nums ${
                      row.done ? 'text-fg' : row.running ? 'text-cyan' : 'text-muted'
                    }`}
                  >
                    {row.done || row.running ? rowTime(row.elapsedMs, lng, msUnit, sUnit) : '—'}
                    {row.done && <span className="ml-1 text-[11px] text-green">✓</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </Reveal>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={replay}
          className="press rounded-lg border border-line bg-surface2/60 px-3 py-1.5 font-mono text-xs text-muted hover:border-blue/40 hover:text-fg"
        >
          {t('stopwatch.replay')}
        </button>
        <p className="font-mono text-[11px] text-faint">
          {t('stopwatch.foot', { warm: seconds(NORMALIZE_WARM_MS, 2, lng) })}
        </p>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {tiles.map((tile, i) => (
          <Reveal key={tile.label} delay={i * 80}>
            <div
              className={`inset-shadow-edge relative h-full overflow-hidden rounded-2xl border bg-surface2/40 p-5 ${
                i === 0 ? 'border-blue/40' : 'border-line'
              }`}
            >
              {i === 0 && (
                <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl" />
              )}
              <div className="relative font-mono text-3xl tracking-tight text-fg tabular-nums">
                {tile.big}
              </div>
              <div className="relative mt-2 text-sm text-muted">{tile.label}</div>
              <div className="relative mt-2.5 font-mono text-[10.5px] text-faint">{tile.how}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="mt-7 grid gap-4 md:grid-cols-2">
          <div className="inset-shadow-edge rounded-2xl border border-line bg-surface2/40 p-5">
            <div className="flex items-baseline justify-between text-sm font-semibold text-fg">
              <span>{t('stopwatch.before')}</span>
              <span className="font-mono text-red tabular-nums">
                {seconds(NORMALIZE_BEFORE_MS, 2, lng)} {sUnit}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
              <div className="h-full rounded-full bg-red/70" style={{ width: '100%' }} />
            </div>
            <p className="mt-2.5 font-mono text-[11px] text-faint">{t('stopwatch.beforeHow')}</p>
          </div>
          <div className="inset-shadow-edge rounded-2xl border border-line bg-surface2/40 p-5">
            <div className="flex items-baseline justify-between text-sm font-semibold text-fg">
              <span>{t('stopwatch.after')}</span>
              <span className="font-mono text-cyan tabular-nums">
                {seconds(OPS[OPS.length - 1].ms, 2, lng)} {sUnit}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
                style={{
                  width: `${Math.round((OPS[OPS.length - 1].ms / NORMALIZE_BEFORE_MS) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2.5 font-mono text-[11px] text-faint">
              {t('stopwatch.afterHow', { warm: seconds(NORMALIZE_WARM_MS, 2, lng) })}
            </p>
          </div>
        </div>
      </Reveal>

      <p className="mt-4 font-mono text-[11px] text-faint">{t('stopwatch.footnote')}</p>
    </section>
  )
}
