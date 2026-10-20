import { type RefObject, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import {
  CUES_BARS,
  CUES_CALL_COLOUR,
  CUES_HOVERS,
  CUES_SECONDS,
  CUES_ZOOM,
  type CuePlacement,
  cuesFrame,
} from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { TRACK_ENVELOPE } from '../../lib/waveforms'
import { AppWave, Cover, EASE, Glyph, ICONS, SceneCursor } from './AppChrome'

const TRACK = CRATE.lasgo2
const GHOST_OPACITY = 0.42
const PADS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ZOOM_ENVELOPE = TRACK_ENVELOPE.slice(CUES_ZOOM.from, CUES_ZOOM.from + CUES_ZOOM.bars)
const ZOOM_LINES = Array.from({ length: CUES_ZOOM.bars }, (_, i) => CUES_ZOOM.from + i)

const at = (bar: number, from: number, bars: number) => ((bar - from) / bars) * 100

function Marks({
  placement,
  ghost,
  from,
  bars,
}: {
  placement: CuePlacement
  ghost: boolean
  from: number
  bars: number
}) {
  const inside = (bar: number) => bar >= from && bar <= from + bars
  const left = (bar: number) => ({
    left: `${at(bar, from, bars)}%`,
    opacity: ghost ? GHOST_OPACITY : 1,
    transition: `left 0.35s ${EASE}, opacity 0.3s ease`,
  })
  return (
    <>
      {[
        { key: 'point', bar: placement.point },
        ...placement.hot.map((h) => ({ key: h.letter, bar: h.bar })),
      ]
        .filter(({ bar }) => inside(bar))
        .map(({ key, bar }) => (
          <i
            key={key}
            className="absolute top-0.5 block h-0 w-0 -translate-x-1/2 border-x-[11px] border-t-[13px] border-x-transparent"
            style={{ ...left(bar), borderTopColor: CUES_CALL_COLOUR }}
          />
        ))}
      {placement.hot
        .filter((h) => inside(h.bar))
        .map((h) => (
          <i
            key={h.letter}
            className="absolute top-0 z-10 block size-3.5 -translate-x-1/2 rounded-[3px] text-center text-[9px] leading-3.5 font-semibold text-bg not-italic"
            style={{ ...left(h.bar), backgroundColor: h.colour }}
          >
            {h.letter}
          </i>
        ))}
    </>
  )
}

function Anchor({ bar, anchorRef }: { bar: number; anchorRef: RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={anchorRef}
      className="absolute top-[55%] block size-0"
      style={{ left: `${at(bar, CUES_ZOOM.from, CUES_ZOOM.bars)}%` }}
    />
  )
}

export default function CuesScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const start = useRef<HTMLSpanElement>(null)
  const closer = useRef<HTMLSpanElement>(null)
  const point = useRef<HTMLSpanElement>(null)
  const save = useRef<HTMLSpanElement>(null)
  const [targets] = useState(() => ({ start, closer, point, save }))
  const frame = cuesFrame(useSceneProgress(ref, CUES_SECONDS * 1000))
  const shown = frame.placed ?? frame.ghost
  const unsaved = frame.placed !== null && !frame.saved
  const pads = new Map((frame.placed?.hot ?? []).map((h) => [h.letter, h.colour]))

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
                <Cover src={TRACK.cover} />
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
              <span className="text-xs whitespace-nowrap text-muted">{t('home.cues.hint')}</span>
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
                left: `${at(CUES_ZOOM.from, 0, CUES_BARS)}%`,
                width: `${(CUES_ZOOM.bars / CUES_BARS) * 100}%`,
              }}
            />
            <span className="absolute inset-x-0 top-4 bottom-0">
              <AppWave values={TRACK_ENVELOPE} className="fill-faint/60" />
            </span>
            {shown && <Marks placement={shown} ghost={!frame.placed} from={0} bars={CUES_BARS} />}
          </div>

          <div className="relative h-40 overflow-hidden rounded-md bg-bg2 sm:h-44">
            {ZOOM_LINES.map((bar) => (
              <i
                key={bar}
                className={`absolute inset-y-0 block w-px ${bar % 16 === 0 ? 'bg-faint/30' : 'bg-faint/10'}`}
                style={{ left: `${at(bar, CUES_ZOOM.from, CUES_ZOOM.bars)}%` }}
              />
            ))}
            <span className="absolute inset-x-0 top-6 bottom-2">
              <AppWave values={ZOOM_ENVELOPE} gap={0.45} />
            </span>
            <i className="absolute inset-y-0 left-1/2 block w-px bg-fg/70" />
            {frame.ghost && (
              <i
                className={`absolute top-4 bottom-0 block border-l ${frame.pressed ? 'border-solid border-fg' : 'border-dashed border-fg/70'}`}
                style={{
                  left: `${at(frame.ghost.point, CUES_ZOOM.from, CUES_ZOOM.bars)}%`,
                  transition: `left 0.35s ${EASE}`,
                }}
              />
            )}
            {shown && (
              <Marks
                placement={shown}
                ghost={!frame.placed}
                from={CUES_ZOOM.from}
                bars={CUES_ZOOM.bars}
              />
            )}
            <Anchor bar={CUES_HOVERS[0]} anchorRef={start} />
            <Anchor bar={CUES_HOVERS[1]} anchorRef={closer} />
            <Anchor bar={CUES_HOVERS[2]} anchorRef={point} />
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

        <SceneCursor
          container={win}
          target={frame.cursor === 'hidden' ? null : targets[frame.cursor]}
        />
      </div>
    </div>
  )
}
