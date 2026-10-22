import { createRef, type RefObject, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUES_BARS,
  CUES_CALL_COLOUR,
  CUES_HOVERS,
  CUES_SECONDS,
  CUES_ZOOM,
  type CueMark,
  type CuePlacement,
  cuesFrame,
} from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { CUES_TRACK_ENVELOPE, CUES_ZOOM_ENVELOPE } from '../../lib/waveforms'
import { AppWave, Cover, EASE, Glyph, ICONS, SceneCursor } from './AppChrome'

const TRACK = { title: 'Something (Extended Mix)', artist: 'Lasgo', duration: '5:56' }
const GHOST_OPACITY = 0.42
const PADS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ZOOM_LINES = Array.from({ length: CUES_ZOOM.span }, (_, i) => CUES_ZOOM.from + i)
const VIEW_SLIDE = `transform 1s ${EASE}`

const at = (bar: number, from: number, bars: number) => ((bar - from) / bars) * 100

type Mark = { key: string; bar: number; ghost: boolean; hot?: CueMark }

const marksOf = (placed: CuePlacement, ghost: CuePlacement | null): Mark[] => [
  ...placed.points.map((bar, i) => ({ key: `point${i}`, bar, ghost: false })),
  ...placed.hot.map((h) => ({ key: h.letter, bar: h.bar, ghost: false, hot: h })),
  ...(ghost
    ? [
        { key: `point${placed.points.length}`, bar: ghost.points[0], ghost: true },
        ...ghost.hot.map((h) => ({ key: h.letter, bar: h.bar, ghost: true, hot: h })),
      ]
    : []),
]

const ZOOM_POINT = (bar: number) => `${at(bar, CUES_ZOOM.from, CUES_ZOOM.span)}%`

function Marks({ marks, from, bars }: { marks: Mark[]; from: number; bars: number }) {
  const shown = marks.filter(({ bar }) => bar >= from && bar <= from + bars)
  const style = (m: Mark) => ({
    left: `${at(m.bar, from, bars)}%`,
    opacity: m.ghost ? GHOST_OPACITY : 1,
    transition: `left 0.35s ${EASE}, opacity 0.3s ease`,
  })
  return (
    <>
      {shown.map((m) => (
        <i
          key={m.key}
          className="absolute top-0.5 block h-0 w-0 -translate-x-1/2 border-x-[11px] border-t-[13px] border-x-transparent"
          style={{ ...style(m), borderTopColor: CUES_CALL_COLOUR }}
        />
      ))}
      {shown.map(
        (m) =>
          m.hot && (
            <i
              key={m.key}
              className="absolute top-0 z-10 block size-3.5 -translate-x-1/2 rounded-[3px] text-center text-[9px] leading-3.5 font-semibold text-bg not-italic"
              style={{ ...style(m), backgroundColor: m.hot.colour }}
            >
              {m.hot.letter}
            </i>
          ),
      )}
    </>
  )
}

function Anchor({ bar, anchorRef }: { bar: number; anchorRef: RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={anchorRef}
      className="absolute top-[55%] block size-0"
      style={{ left: `${at(bar, CUES_ZOOM.from, CUES_ZOOM.span)}%` }}
    />
  )
}

export default function CuesScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const save = useRef<HTMLSpanElement>(null)
  const auto = useRef<HTMLSpanElement>(null)
  const [anchors] = useState(() =>
    CUES_HOVERS.map((hovers) => hovers.map(() => createRef<HTMLSpanElement>())),
  )
  const frame = cuesFrame(useSceneProgress(ref, CUES_SECONDS * 1000))
  const shown = frame.ghost ?? frame.proposal
  const marks = marksOf(frame.placed, shown)
  const unsaved = frame.placed.points.length > 0 && !frame.saved
  const pads = new Map(frame.placed.hot.map((h) => [h.letter, h.colour]))
  const viewFrom = CUES_ZOOM.views[frame.view]
  const step = ['start', 'closer', 'point'].indexOf(frame.cursor)
  const target =
    frame.cursor === 'hidden'
      ? null
      : frame.cursor === 'save'
        ? save
        : frame.cursor === 'auto'
          ? auto
          : anchors[0][step]

  return (
    <div ref={ref}>
      <div
        ref={win}
        aria-hidden="true"
        className="inset-shadow-edge relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-bg text-left shadow-2xl shadow-black/40"
      >
        <div className="flex h-9 items-center pl-3.5">
          <span className="flex gap-[7px]">
            <i className="block size-[11px] rounded-full bg-red" />
            <i className="block size-[11px] rounded-full bg-amber" />
            <i className="block size-[11px] rounded-full bg-green" />
          </span>
        </div>

        <div className="flex flex-col gap-3 px-4 pt-2 pb-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
            <span className="flex min-w-0 items-center gap-3.5">
              <span className="size-10 flex-none overflow-hidden rounded-md">
                <Cover />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-fg">
                  {TRACK.title}
                </span>
                <span className="block truncate text-xs text-muted">{TRACK.artist}</span>
              </span>
              <span
                className="text-xs whitespace-nowrap text-amber transition-opacity duration-300"
                style={{ opacity: unsaved ? 1 : 0 }}
              >
                {t('home.cues.unsaved')}
              </span>
              <span className="hidden text-xs text-faint tabular-nums sm:inline">
                {TRACK.duration}
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg2 px-2.5 text-[12.5px] whitespace-nowrap">
                <span className="text-muted">{t('home.cues.flow')}</span>
                <span className="font-medium text-fg">{t('home.cues.flowName')}</span>
                <span className="text-faint">
                  <Glyph size={12}>{ICONS.chevron}</Glyph>
                </span>
              </span>
              <span
                ref={auto}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-blue px-2.5 text-xs font-semibold whitespace-nowrap text-blue transition-transform duration-200"
                style={{ transform: frame.autoPressed ? 'scale(0.96)' : 'none' }}
              >
                <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
                  <path
                    d="M8 1 9.6 6.4 15 8 9.6 9.6 8 15 6.4 9.6 1 8 6.4 6.4Z"
                    fill="currentColor"
                  />
                </svg>
                {t('home.cues.autoButton')}
              </span>
              <span className="flex-1" />
              <span
                className="text-xs whitespace-nowrap text-muted transition-opacity duration-300"
                style={{ opacity: unsaved ? 1 : 0 }}
              >
                {t('home.cues.discard')}
              </span>
              <span
                ref={save}
                className="flex h-8 items-center rounded-lg border border-line bg-surface2 px-3 text-xs font-semibold whitespace-nowrap text-fg transition-[opacity,transform] duration-200"
                style={{
                  opacity: unsaved ? 1 : 0.4,
                  transform: frame.savePressed ? 'scale(0.96)' : 'none',
                }}
              >
                {t('home.cues.save')}
              </span>
            </span>
          </div>

          <div className="relative h-12 overflow-hidden rounded-md bg-bg2">
            <span
              className="absolute inset-y-0 block border-x border-blue/30 bg-blue/10"
              style={{
                left: `${at(viewFrom, 0, CUES_BARS)}%`,
                width: `${(CUES_ZOOM.bars / CUES_BARS) * 100}%`,
                transition: `left 1s ${EASE}`,
              }}
            />
            <span className="absolute inset-x-0 top-4 bottom-0">
              <AppWave values={CUES_TRACK_ENVELOPE} />
            </span>
            <Marks marks={marks} from={0} bars={CUES_BARS} />
          </div>

          <div className="relative h-40 overflow-hidden rounded-md bg-bg2 sm:h-44">
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${(CUES_ZOOM.span / CUES_ZOOM.bars) * 100}%`,
                transform: `translateX(-${((viewFrom - CUES_ZOOM.from) / CUES_ZOOM.span) * 100}%)`,
                transition: VIEW_SLIDE,
              }}
            >
              {ZOOM_LINES.map((bar) => (
                <i
                  key={bar}
                  className={`absolute inset-y-0 block w-px ${bar % 16 === 0 ? 'bg-faint/25' : bar % 4 === 0 ? 'bg-faint/15' : 'bg-faint/[0.07]'}`}
                  style={{ left: `${at(bar, CUES_ZOOM.from, CUES_ZOOM.span)}%` }}
                >
                  {bar % 4 === 0 && (
                    <i className="absolute top-0 left-0 block h-1.5 w-px bg-red/60" />
                  )}
                </i>
              ))}
              <span className="absolute inset-x-0 top-6 bottom-2">
                <AppWave values={CUES_ZOOM_ENVELOPE} />
              </span>
              {shown && (
                <i
                  className={`absolute top-4 bottom-0 block border-l ${frame.pressed ? 'border-solid border-fg' : 'border-dashed border-fg/70'}`}
                  style={{ left: ZOOM_POINT(shown.points[0]), transition: `left 0.35s ${EASE}` }}
                />
              )}
              {frame.proposal && (
                <span
                  className="absolute top-5 z-20 flex -translate-x-full items-center gap-1.5 rounded-full border border-dashed border-blue bg-bg py-0.5 pr-0.5 pl-2.5 text-[11px] font-semibold whitespace-nowrap text-blue"
                  style={{ left: `calc(${ZOOM_POINT(frame.proposal.points[0])} - 6px)` }}
                >
                  {t('home.cues.ask')}
                  <span
                    className={`grid h-4 min-w-4 place-items-center rounded-full px-1 transition-colors duration-200 ${frame.returnPressed ? 'bg-fg text-bg' : 'bg-blue text-bg'}`}
                  >
                    ↵
                  </span>
                </span>
              )}
              <Marks marks={marks} from={CUES_ZOOM.from} bars={CUES_ZOOM.span} />
              {CUES_HOVERS[0].map((bar, i) => (
                <Anchor key={bar} bar={bar} anchorRef={anchors[0][i]} />
              ))}
            </div>
            <i className="absolute inset-y-0 left-1/2 block w-px bg-fg/70" />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="mr-1.5 grid size-8 flex-none place-items-center rounded-lg bg-bg2 text-fg">
              <Glyph size={13}>{ICONS.play}</Glyph>
            </span>
            {PADS.map((letter) => {
              const colour = pads.get(letter)
              return (
                <span
                  key={letter}
                  className={`grid size-7 flex-none place-items-center rounded-md text-[11px] font-semibold transition-colors duration-300 ${
                    colour ? 'text-bg' : 'border border-dashed border-faint/50 text-faint'
                  }`}
                  style={colour ? { backgroundColor: colour } : undefined}
                >
                  {letter}
                </span>
              )
            })}
            <span className="ml-2 hidden text-[12.5px] whitespace-nowrap text-muted sm:inline">
              ‹ {t('home.cues.addCall')} ›
            </span>
          </div>
        </div>

        <SceneCursor container={win} target={target} />
      </div>
    </div>
  )
}
