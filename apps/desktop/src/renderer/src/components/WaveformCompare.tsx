import { Columns2, Layers2, Rows2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  LoudnessResult,
  NormalizeConfig,
  WaveformResult,
  WaveformScan,
} from '../../../shared/types'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { useWaveform, useWaveformScan } from '../hooks/useWaveform'
import { useWaveformWindow, windowFor } from '../hooks/useWaveformWindow'
import { formatDb } from '../lib/quality'
import { formatTime, timeTicks } from '../lib/duration'
import { clippedCount, drawWaveform, previewPeaks } from '../lib/waveform'
import { Tooltip } from './Tooltip'
import { ZoomStepper } from './ZoomStepper'
import { WaveformSkeleton } from './WaveformSkeleton'

// Half the player strip's raster per side-by-side column (each sits in half the
// panel width); the overlaid canvas spans the panel, so it gets the full raster.
const CANVAS_W = 600
// Exported (with the strip and its blue) for the trim section, whose full-width
// wave must read as the same instrument as the loudness preview's.
export const OVERLAY_W = 1200
// 1.5× the strips' 96 CSS px, so the taller wave stays supersampled-crisp.
const CANVAS_H = 144

// The deepest zoom step, shared with the trim section: ×256 across a 6-minute
// track puts ~1.4 s in the visible panel — cut-placing territory. Past ×8 the
// strip stops stretching the 8192 overview buckets and re-decodes the visible
// window at full fidelity (useWaveformWindow), so depth keeps real detail
// instead of widening blocks.
export const ZOOM_MAX = 256

// Where the viewport canvas takes over from the stretched base raster: at ×8 the
// base still has ≥2 buckets per panel pixel; deeper, the re-decode earns its keep.
const HIRES_MIN_ZOOM = 8
// The stretched base raster's bitmap cap, safely under Chromium's per-dimension
// canvas ceiling; past it the base blurs, but the hi-res canvas covers it there.
const BASE_RASTER_MAX = 32640

// Once the hi-res canvas is drawing the visible detail (past HIRES_MIN_ZOOM), the base is
// only the blurry backdrop at the edges — so it needs no more than a couple of panels of
// pixels. Rasterizing it to the full zoom×width instead built a canvas tens of thousands
// of pixels wide: a huge GPU bitmap that janked the editor and, un-clipped for a frame
// while a re-render (an auto-match tick) resettled the layout, smeared across the app.
const BASE_RASTER_HIRES_CAP = 4096

// The ×N chip's text: pinch zoom makes the factor continuous, so round to what
// the eye needs — tenths under ×10, whole steps above ("×3.4", "×27").
export function zoomLabel(zoom: number): string {
  return `×${zoom >= 10 ? Math.round(zoom) : Number(zoom.toFixed(1))}`
}

// The colour key the legends' dots repeat: the converted file keeps the player's
// accent blue, the source goes muted so "louder than before" reads as blue fringes
// growing past the grey in the overlaid view.
export const AFTER_COLOR = 'rgba(96, 165, 250, 0.8)'
const BEFORE_COLOR = 'rgba(148, 163, 184, 0.7)'

type CompareView = 'side' | 'overlay'

interface StripData {
  wave: (WaveformResult & Partial<WaveformScan>) | null | undefined
  loading: boolean
  loudness: LoudnessResult | null | undefined
}

// One file's decoded envelope plus its measurement — for the "after" side that's
// the converted output, the figures that say what normalization actually applied.
// Both share the per-path caches the player and the loudness readout warm. The compare
// strip is the one consumer of the clip/channel scan (marks + split L/R), so it fetches
// that separate probe and merges its flags onto the wave — the rest of the strip keeps
// reading wave.clipped / wave.channels unchanged, none the wiser that they now arrive
// from their own cache entry rather than baked into the peaks probe.
function useStripData(path: string, enabled: boolean): StripData {
  const { data: peaks, isFetching } = useWaveform(path, enabled)
  const { data: scan } = useWaveformScan(path, enabled)
  const { data: loudness } = useTrackLoudness(path, enabled)
  const wave = peaks
    ? { ...peaks, clipped: scan?.clipped, channels: scan?.channels }
    : peaks
  return { wave, loading: isFetching && !peaks, loudness }
}

function Legend({
  testid,
  color,
  label,
  loudness,
}: {
  testid: string
  color: string
  label: string
  loudness: LoudnessResult | null | undefined
}): React.JSX.Element {
  return (
    <span data-testid={testid} className="flex min-w-0 items-center gap-1.5 text-[10px]">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="font-medium uppercase tracking-wider text-fg-dim">{label}</span>
      {loudness && (
        <span className="truncate tabular-nums text-fg-dim">
          {`${formatDb(loudness.integratedLufs)} LUFS · ${formatDb(loudness.truePeakDb)} dBTP`}
        </span>
      )}
    </span>
  )
}

export function Strip({
  wave,
  loading,
  color,
  clipDb,
  limitDb,
  marks = true,
  split = false,
  background,
  raster = CANVAS_W,
  zoom = 1,
  onZoomChange,
  inputPath,
  onViewChange,
  scrollerRef,
  tall = false,
  trimShade,
  children,
}: StripData & {
  color: string
  clipDb?: number
  // The preview's limiter line: bars clamp to it and the clamped ones paint red.
  limitDb?: number
  // The legend toggle: false keeps the limiter clamp but paints no red.
  marks?: boolean
  // Audacity-style stacked L/R lanes, one per decoded channel — only honored when
  // the wave actually carries channel lanes, so a mono file stays a single wave.
  split?: boolean
  // A second envelope drawn behind in the muted grey — the original under a preview.
  background?: WaveformResult | null
  raster?: number
  // rekordbox-style stretch factor: the strip grows to zoom× the panel width inside
  // a horizontal scroller. Still the same decoded buckets, just drawn wider.
  zoom?: number
  // Enables trackpad pinch (and ⌘/Ctrl+wheel) zoom over the strip, anchored at the
  // cursor: the spot under the pointer stays put, DAW-style, instead of the view
  // re-centering. The parent owns the zoom state, so the strip only reports.
  onZoomChange?: (zoom: number) => void
  // Enables the deep zoom's windowed re-decode: past ×8 the visible slice of THIS
  // file is decoded at full fidelity onto a viewport canvas instead of stretching
  // the 8192 overview buckets into blocks. Absent, deep zoom just magnifies.
  inputPath?: string
  // Reports the visible slice (0..1 fractions of the track) the strip already
  // tracks for its deep zoom, so an overlay can render only what shows — the
  // grid section's beat lines would be thousands of nodes drawn full-length.
  onViewChange?: (view: { from: number; to: number }) => void
  // Hands the scroll container out, so a parent can drive the visible window —
  // the grid section's overview lane navigates by setting scrollLeft here.
  scrollerRef?: React.RefObject<HTMLDivElement | null>
  // Double-height lanes for a maximized section: the whole window is available,
  // so the wave takes it instead of floating in empty space.
  tall?: boolean
  // The silence trim staged elsewhere, as fractions of the track (0..1) cut off
  // the head and tail. Dimmed rather than clipped: the wave stays whole so a
  // section that anchors times to the ORIGINAL file (the beatgrid) doesn't jump
  // its grid every time the trim moves, while the user still sees which audio
  // the export drops. Same shade the trim section's own lanes use.
  trimShade?: { startFrac?: number; endFrac?: number }
  // Overlay rendered inside the zoomed strip, so children positioned by percent
  // (the trim section's shades and handles) track the wave through zoom and scroll.
  children?: React.ReactNode
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hiResRef = useRef<HTMLCanvasElement>(null)
  // The deep zoom's real detail: past ×8, re-decode the visible window of this
  // file at full fidelity and draw it on the viewport canvas below. Skipped for
  // the composed views (split lanes, preview-over-original) — those stay on the
  // stretched overview, and their work happens at shallow zoom anyway. Declared
  // up here because the base-draw effect below reads it: past the raster cap the
  // base cannot draw the wave right, so it draws nothing at all.
  const hiResActive =
    !!inputPath &&
    !!wave &&
    zoom > HIRES_MIN_ZOOM &&
    !(split && wave.channels?.length === 2) &&
    !background &&
    limitDb === undefined
  const scrollRef = useRef<HTMLDivElement>(null)
  // The cursor's position over the strip, as a 0..1 ratio (for the bucket/time math)
  // plus the raw x (for the readout's placement). Null while the pointer is away.
  const [hover, setHover] = useState<{ x: number; ratio: number } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoom/raster only feed the canvas width attribute in JSX, but changing that attribute wipes the bitmap — the effect must re-run to redraw at the new raster or the strip goes blank.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !wave) return
    // Past the raster cap the base bitmap is stretched over a box many times
    // wider (×128 puts 32 640 px of pixels under 20 000+ px of CSS), which
    // smears every bar into a solid block — the "deformed wave" seen while
    // navigating, before the hi-res window lands over it. So once the viewport
    // canvas is covering the lane, the base stays EMPTY: it still lays the lane
    // out and paints the field, but it never draws a wave it cannot draw right.
    if (hiResActive) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    if (background) drawWaveform(canvas, background.peaks, { color: BEFORE_COLOR })
    // With no dB line dialed in, the red marks come from the decoder's true-clipping
    // flags — drawWaveform only consults them when clipDb/limitDb are absent.
    const lanes = split && wave.channels?.length === 2 ? wave.channels : null
    if (lanes) {
      // Each lane is that channel's own envelope and clip flags, so a clip living
      // in one channel only reads there — same as Audacity's two rows.
      lanes.forEach((lane, i) => {
        drawWaveform(canvas, lane.peaks, {
          color,
          clipDb,
          clipped: lane.clipped,
          marks,
          clear: i === 0 && !background,
          lane: { index: i, count: lanes.length },
        })
      })
    } else {
      drawWaveform(canvas, wave.peaks, {
        color,
        clipDb,
        clipped: wave.clipped,
        limitDb,
        marks,
        clear: !background,
      })
    }
  }, [wave, color, clipDb, limitDb, marks, split, background, raster, zoom, tall, hiResActive])
  // A zoom step re-anchors the scroller so the spot the user is working on stays
  // put: at the cursor for a pinch/wheel zoom (anchorRef, set by the handler
  // below), at the middle for a button step — zooming must never teleport the
  // view away from the clip or cut being inspected.
  const prevZoom = useRef(zoom)
  const anchorRef = useRef<{ ratio: number; viewX: number } | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || prevZoom.current === zoom) return
    const factor = zoom / prevZoom.current
    prevZoom.current = zoom
    const anchor = anchorRef.current
    anchorRef.current = null
    if (anchor) {
      el.scrollLeft = Math.max(0, anchor.ratio * el.clientWidth * zoom - anchor.viewX)
      return
    }
    const center = el.scrollLeft + el.clientWidth / 2
    el.scrollLeft = Math.max(0, center * factor - el.clientWidth / 2)
  }, [zoom])
  // Trackpad pinch (ctrlKey wheel) and ⌘+wheel zoom the strip continuously,
  // anchored under the cursor. A native non-passive listener because React binds
  // onWheel passively at the root, which silently ignores the preventDefault that
  // keeps the pinch from zooming the whole window.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !onZoomChange) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const current = zoomRef.current
      const next = Math.min(ZOOM_MAX, Math.max(1, current * Math.exp(-e.deltaY * 0.01)))
      if (next === current) return
      const rect = el.getBoundingClientRect()
      const viewX = e.clientX - rect.left
      anchorRef.current = {
        ratio: rect.width === 0 ? 0 : (el.scrollLeft + viewX) / (rect.width * current),
        viewX,
      }
      onZoomChange(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onZoomChange])
  // Splitting halves each channel's room, so the strip grows by half in return:
  // every lane keeps roughly the mono wave's readable height, like Audacity's rows.
  const splitActive = split && wave?.channels?.length === 2
  // The visible slice of the strip, as 0..1 fractions of the track — what the deep
  // zoom's viewport canvas draws and what the windowed re-decode is asked for.
  // rAF-throttled off the native scroll so a flick costs one state write per frame.
  const [view, setView] = useState({ from: 0, to: 1 })
  // Handed out through a ref so an inline callback prop never re-runs the effect.
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  useEffect(() => {
    onViewChangeRef.current?.(view)
  }, [view])
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoom isn't read inside, but a zoom step at scrollLeft 0 fires no scroll event — the effect must re-run to recompute the shrunken view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const total = el.scrollWidth
      if (total === 0) return
      const from = el.scrollLeft / total
      const to = (el.scrollLeft + el.clientWidth) / total
      setView((v) => (v.from === from && v.to === to ? v : { from, to }))
    }
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [zoom])
  const win = hiResActive
    ? windowFor(wave.durationSec, view.from, zoom)
    : { startSec: 0, durSec: 0 }
  // Fetch only once the window RESTS: a fast scrub (the grid section's overview
  // lane) churns through quantized windows faster than ffmpeg decodes them, and
  // enqueueing every intermediate one left the queue playing catch-up for
  // seconds after release. While the fetch waits, the draw below falls back to
  // the coarse overview slice, so the strip stays live — just soft.
  const { startSec: winStart, durSec: winDur } = win
  const [settledWin, setSettledWin] = useState(win)
  useEffect(() => {
    const id = setTimeout(() => {
      setSettledWin((prev) =>
        prev.startSec === winStart && prev.durSec === winDur
          ? prev
          : { startSec: winStart, durSec: winDur },
      )
      // Short: the window request is what makes a fast move show the field for a
      // moment, so it must chase the view closely. Long enough that a fling still
      // coalesces its frames into one decode.
    }, 40)
    return () => clearTimeout(id)
  }, [winStart, winDur])
  const { data: hiRes } = useWaveformWindow(
    inputPath,
    settledWin.startSec,
    settledWin.durSec,
    hiResActive && settledWin.durSec > 0,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: tall only feeds the canvas height attribute in JSX, but changing that attribute wipes the bitmap — the effect must re-run to redraw at the new height.
  useEffect(() => {
    const canvas = hiResRef.current
    if (!canvas || !hiResActive || !wave) return
    // Sizing the bitmap is the whole ballgame: a raster smaller than the CSS box
    // it is stretched over scales every bar up, and THAT is the "deformed/fat
    // wave" — during playback (the box is one viewport) and, worse, on a fast
    // move (the box becomes the whole cached window, three viewports wide). So
    // the bitmap is sized per pass, from the box this very draw will occupy.
    const panelPx = scrollRef.current?.clientWidth ?? 0
    const sizeFor = (boxPx: number): void => {
      if (boxPx <= 0) return
      const target = Math.min(
        8192,
        Math.max(600, Math.round(boxPx * (window.devicePixelRatio || 1))),
      )
      if (canvas.width !== target) canvas.width = target
    }
    // Only ever draw a window that actually covers the view. The overview slice
    // is NOT a usable stand-in at this depth — at ×128 it hands four buckets to a
    // 1300 px canvas, and those stretch into the blocky "deformed wave" a fast
    // move used to leave behind. So while the decode is catching up, the canvas
    // keeps the last good window's pixels and simply parks over the stretch it
    // still describes: the wave slides with the view (correct, just not yet
    // re-cut for the new edges) instead of flashing blocks.
    const dur = wave.durationSec
    const covers =
      hiRes &&
      hiRes.durSec > 0 &&
      hiRes.startSec / dur <= view.from + 1e-6 &&
      (hiRes.startSec + hiRes.durSec) / dur >= view.to - 1e-6
    if (!hiRes || hiRes.durSec <= 0) return
    const winFrom = hiRes.startSec / dur
    const winSpan = hiRes.durSec / dur
    if (covers) {
      sizeFor(panelPx)
      drawWaveform(canvas, hiRes.peaks, {
        color,
        clipDb,
        marks,
        window: {
          from: (view.from - winFrom) / winSpan,
          to: (view.to - winFrom) / winSpan,
        },
      })
      // Position and pixels move as one: the canvas sits at the very window it
      // just drew, in strip percentages, so scrolling can never shear it off the
      // overlays.
      canvas.style.left = `${view.from * 100}%`
      canvas.style.width = `${(view.to - view.from) * 100}%`
      return
    }
    // Outrun: redraw the whole cached window at its own resolution and let it sit
    // where it belongs on the strip — the view has moved off it, so part of the
    // lane shows the empty field until the new window lands, which reads as
    // "loading", not as a broken wave.
    // The cached window spans winSpan of the strip; at this zoom that is
    // (winSpan × zoom) panels wide — the bitmap must match, or the bars stretch.
    sizeFor(panelPx * winSpan * zoom)
    drawWaveform(canvas, hiRes.peaks, { color, clipDb, marks })
    canvas.style.left = `${winFrom * 100}%`
    canvas.style.width = `${winSpan * 100}%`
  }, [hiResActive, hiRes, view, wave, color, clipDb, marks, tall, raster, zoom])
  const readout = ((): { time: string; db: string; over: boolean } | null => {
    if (!hover || !wave || wave.peaks.length === 0) return null
    const idx = Math.min(wave.peaks.length - 1, Math.floor(hover.ratio * wave.peaks.length))
    const amp = wave.peaks[idx]
    const markDb = limitDb ?? clipDb
    // The displayed level honors the preview's limiter, like the drawn bar does.
    const shown = limitDb !== undefined ? Math.min(amp, 10 ** (limitDb / 20)) : amp
    return {
      time: formatTime(hover.ratio * wave.durationSec),
      db: formatDb(shown > 0 ? 20 * Math.log10(shown) : Number.NEGATIVE_INFINITY),
      over: markDb !== undefined ? amp > 10 ** (markDb / 20) : marks && wave.clipped?.[idx] === true,
    }
  })()
  return (
    // overflow-y stays hidden in both states: anything poking past the strip's height
    // (the hover chip at an edge) must be clipped, never grow a vertical scrollbar
    // that jiggles the wave under the cursor.
    <div
      ref={(el) => {
        scrollRef.current = el
        if (scrollerRef) scrollerRef.current = el
      }}
      data-testid="waveform-scroller"
      // w-full + min-w-0 + contain pin the scroller to its column's width and isolate its
      // layout, so the zoom×100% strip inside can only ever scroll — it can never push the
      // scroller wide and spill the wave across the app, not even for the one frame an
      // auto-match re-render resettles the layout in.
      className={`scrollbar-none w-full min-w-0 [contain:layout_paint] overflow-y-hidden rounded-lg ${
        zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'
      }`}
    >
      <div
        data-testid="waveform-strip"
        className="relative"
        style={{ width: `${zoom * 100}%` }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (rect.width === 0 || !wave) return
          const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left))
          setHover({ x, ratio: x / rect.width })
        }}
        onPointerLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          width={Math.min(
            hiResActive ? BASE_RASTER_HIRES_CAP : BASE_RASTER_MAX,
            Math.round(raster * zoom),
          )}
          height={splitActive ? CANVAS_H * 1.5 : tall ? CANVAS_H * 2 : CANVAS_H}
          className={`block w-full rounded-lg bg-[var(--color-field)] ${
            splitActive ? 'h-36' : tall ? 'h-48' : 'h-24'
          }`}
        />
        {/* The deep zoom's detail canvas: absolutely positioned IN CONTENT
            coordinates at the exact window it depicts (left/width are set in the
            same effect that draws, so position and pixels commit together) — the
            capped base raster underneath goes blurry past ~×27, but this covers
            where the eye is. It used to be viewport-sticky and redrawn per scroll
            frame, which lagged the natively-scrolling overlays (grid lines, ruler)
            by a frame mid-drag; anchored to the content it scrolls in lockstep and
            a fast fling just shows the coarse base at the edges until the next
            redraw. Pointer events pass through so scrub/hover stay the strip's. */}
        {hiResActive && (
          <canvas
            ref={hiResRef}
            data-testid="waveform-hires"
            width={2400}
            height={tall ? CANVAS_H * 2 : CANVAS_H}
            className={`pointer-events-none absolute top-0 left-0 block rounded-lg bg-[var(--color-field)] ${tall ? 'h-48' : 'h-24'}`}
            style={{ width: `${100 / zoom}%` }}
          />
        )}
        {loading && <WaveformSkeleton testid="waveform-compare-loading" />}
        {/* The dropped-audio shade: the head and tail the staged trim cuts, dimmed
            over the wave rather than removed from it. Percent-positioned like the
            ruler, so they track the wave through zoom and scroll. */}
        {trimShade && !loading && (trimShade.startFrac ?? 0) > 0 && (
          <span
            data-testid="waveform-trim-shade-start"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-10 rounded-l-lg bg-[var(--color-panel)]/70"
            style={{ width: `${(trimShade.startFrac ?? 0) * 100}%` }}
          />
        )}
        {trimShade && !loading && (trimShade.endFrac ?? 0) > 0 && (
          <span
            data-testid="waveform-trim-shade-end"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 rounded-r-lg bg-[var(--color-panel)]/70"
            style={{ width: `${(trimShade.endFrac ?? 0) * 100}%` }}
          />
        )}
        {/* The ruler appears with the zoom: at ×1 the strip is an overview and ticks
            are clutter, but zoomed in, "where am I in the track" needs answering
            without dragging the hover chip around. Percent-positioned, so the ticks
            ride the zoomed width and scroll with the wave. */}
        {zoom > 1 && wave && (
          <div
            data-testid="waveform-ruler"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0"
          >
            {timeTicks(wave.durationSec, zoom).map((t) => (
              <span key={t.sec} className="absolute bottom-0" style={{ left: `${t.pct}%` }}>
                {/* Both the tick and its label carry the halo: over a loud passage the
                    hairline vanished into the bars just as the digits did, and a scale
                    whose marks you cannot see is not a scale. */}
                <span className="wave-tick absolute bottom-0 h-2.5 w-px bg-fg-muted" />
                <span className="wave-label absolute bottom-0.5 pl-1 text-[9px] font-medium leading-none tabular-nums text-fg">
                  {t.label}
                </span>
              </span>
            ))}
          </div>
        )}
        {readout && hover && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-fg/40"
              style={{ left: hover.x }}
            />
            {/* Inside the strip, not above it: the scroller clips vertical overflow
                when zoomed, and floating over the legends read as part of them. */}
            <span
              data-testid="waveform-hover"
              // whitespace-nowrap keeps the chip one line at the strip's edges: an
              // absolute element squeezed against its container's right edge wraps,
              // grows taller than the strip, and used to force a vertical scrollbar.
              className={`pointer-events-none absolute top-1 whitespace-nowrap rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[10px] tabular-nums shadow-sm ${
                readout.over ? 'text-danger' : 'text-fg-muted'
              }`}
              style={{
                left: hover.x,
                transform: `translateX(${hover.ratio > 0.85 ? 'calc(-100% - 6px)' : '6px'})`,
              }}
            >
              {readout.time} · {readout.db} dB
            </span>
          </>
        )}
        {children}
      </div>
    </div>
  )
}

// The red counterpart to the legends' colour dots, shown only when the wave actually
// pokes over the ceiling: it names the dB line the red bars mark, so the color isn't
// a mystery — and a clean track never warns. It doubles as the switch for the marks:
// a busy vinyl rip can paint mostly red, so a click hides them, another brings them
// back — the label stays up either way so the way back is obvious.
function ClippedFlag({
  wave,
  clipDb,
  active,
  onToggle,
}: {
  wave: (WaveformResult & Partial<WaveformScan>) | null | undefined
  // The ceiling the marks measure against; absent, the marks are the decoder's
  // true-clipping flags instead.
  clipDb?: number
  active: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const count = !wave
    ? 0
    : clipDb !== undefined
      ? clippedCount(wave.peaks, clipDb)
      : (wave.clipped?.filter(Boolean).length ?? 0)
  if (count === 0) return null
  return (
    <button
      type="button"
      data-testid="waveform-clipped"
      aria-pressed={active}
      onClick={onToggle}
      className="press flex min-w-0 items-center gap-1.5 text-[10px]"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-line-strong)]'}`}
      />
      <span
        className={`truncate font-medium tabular-nums ${active ? 'text-danger' : 'text-fg-dim'}`}
      >
        {/* When the marks mean digital clipping — the decoder's flags, or the peak
            preview's 0 dBFS line — call it what Audacity calls it; "Peaks over
            -0.0 dB" says nothing. A real ceiling keeps its dB figure. */}
        {clipDb === undefined || clipDb >= 0
          ? tr('editor.waveformClipping')
          : tr('editor.waveformClipped', { db: formatDb(clipDb) })}
      </span>
    </button>
  )
}

// GitHub-style image diff: both envelopes on one canvas, the source behind in grey
// and the converted file over it in blue. On barely-changed audio the two cover
// each other, so an onion-skin fade slider crossfades the blue layer — scrubbing it
// makes the difference move, which the eye catches where a static blend can't.
function OverlayStrip({ before, after }: { before: StripData; after: StripData }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fade, setFade] = useState(0.5)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !before.wave || !after.wave) return
    drawWaveform(canvas, before.wave.peaks, { color: BEFORE_COLOR })
    drawWaveform(canvas, after.wave.peaks, {
      color: `rgba(96, 165, 250, ${(0.9 * fade).toFixed(3)})`,
      clear: false,
    })
  }, [before.wave, after.wave, fade])
  return (
    <div data-testid="waveform-overlay">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={OVERLAY_W}
          height={CANVAS_H}
          className="block h-24 w-full rounded-lg bg-[var(--color-field)]"
        />
        {(before.loading || after.loading) && <WaveformSkeleton testid="waveform-compare-loading" />}
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-2">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: BEFORE_COLOR }}
        />
        <input
          type="range"
          data-testid="waveform-overlay-fade"
          aria-label={tr('editor.waveformFade')}
          min={0}
          max={1}
          step={0.01}
          value={fade}
          onChange={(e) => setFade(Number(e.target.value))}
          className="player-volume-range h-1 w-32 cursor-pointer"
        />
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: AFTER_COLOR }}
        />
      </div>
    </div>
  )
}

// The source's wave alone, for before a conversion exists: the same strip, figures
// and clip marks as the comparison, so the normalization controls above are tuned
// against what the file actually looks like instead of blind. With Loudness or Peak
// dialed in it goes one further: the original drops behind in grey and the predicted
// post-normalization envelope draws in front — a preview of the dials' outcome.
export function WaveformSolo({
  inputPath,
  enabled,
  clipDb,
  normalize,
  trimShade,
}: {
  inputPath: string
  enabled: boolean
  // The active mode's ceiling; absent (normalization off), the red marks are the
  // decoder's true-clipping flags instead of any envelope threshold.
  clipDb?: number
  normalize: NormalizeConfig
  // The staged trim's dropped head/tail, dimmed over the wave (same as the other
  // sections) so the loudness view shows which audio the export leaves out.
  trimShade?: { startFrac?: number; endFrac?: number }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const source = useStripData(inputPath, enabled)
  // The clip marks' switch (the ClippedFlag legend). Per-mount state: a track flip
  // remounts the editor, and marks defaulting back on is the safe reading.
  const [marks, setMarks] = useState(true)
  // rekordbox-style zoom over the strip, ×1..×8 in doublings. Per-mount too: a new
  // track starts at the full-width overview.
  const [zoom, setZoom] = useState(1)
  // The split L/R view. Per-mount like the rest: the mono overview is the default
  // reading and a track flip starts back there.
  const [split, setSplit] = useState(false)
  const preview = useMemo(
    () =>
      source.wave
        ? previewPeaks(source.wave.peaks, normalize, source.loudness?.integratedLufs)
        : null,
    [source.wave, normalize, source.loudness],
  )
  const previewWave =
    preview && source.wave ? { peaks: preview.peaks, durationSec: source.wave.durationSec } : null
  return (
    <div data-testid="waveform-solo" className="mt-3">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <Legend
          testid="waveform-source"
          color={previewWave ? BEFORE_COLOR : AFTER_COLOR}
          label={tr('editor.waveformSource')}
          loudness={source.loudness}
        />
        {previewWave && preview ? (
          <>
            <span data-testid="waveform-preview" className="flex min-w-0 items-center gap-1.5 text-[10px]">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: AFTER_COLOR }}
              />
              <span className="font-medium uppercase tracking-wider text-fg-dim">
                {tr('editor.waveformPreview')}
              </span>
              <span className="truncate tabular-nums text-fg-dim">
                {normalize.mode === 'loudness'
                  ? `${formatDb(normalize.targetLufs)} LUFS · ${formatDb(normalize.truePeakDb)} dBTP`
                  : `${formatDb(normalize.peakDb)} dBFS`}
                {/* The felt number: how hard this pushes, signed so up and down read apart. */}
                {` · ${preview.gainDb >= 0 ? '+' : ''}${formatDb(preview.gainDb)} dB`}
              </span>
            </span>
            {/* The same switch as the plain view, counting on the PREDICTED wave: it
                appears while the dialed values push peaks over the mode's red line
                (the loudness ceiling, or digital clipping for peak mode) — dial back
                until it goes, and the optimal value found itself. */}
            <ClippedFlag
              wave={previewWave}
              clipDb={preview.limitDb}
              active={marks}
              onToggle={() => setMarks((m) => !m)}
            />
          </>
        ) : (
          <ClippedFlag
            wave={source.wave}
            clipDb={clipDb}
            active={marks}
            onToggle={() => setMarks((m) => !m)}
          />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* Audacity-style L/R lanes, only when the decoder shipped them (stereo
              file, scan succeeded) and the strip shows the real wave — the preview's
              predicted envelope is mono, so the toggle hides while it is up. */}
          {!previewWave && source.wave?.channels?.length === 2 && (
            <button
              type="button"
              data-testid="waveform-split"
              aria-label={tr('editor.waveformSplit')}
              aria-pressed={split}
              onClick={() => setSplit((s) => !s)}
              className={`press mr-1 flex h-5 w-5 items-center justify-center rounded ${
                split ? 'bg-[var(--color-panel-2)] text-fg' : 'text-fg-dim hover:text-fg'
              }`}
            >
              <Rows2 className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
          <ZoomStepper
            label={zoomLabel(zoom)}
            onOut={() => setZoom((z) => Math.max(1, z / 2))}
            onIn={() => setZoom((z) => Math.min(ZOOM_MAX, z * 2))}
            onReset={() => setZoom(1)}
            outDisabled={zoom <= 1}
            inDisabled={zoom >= ZOOM_MAX}
            resetDisabled={zoom <= 1}
            labels={{
              out: tr('editor.waveformZoomOut'),
              in: tr('editor.waveformZoomIn'),
              reset: tr('editor.waveformZoomReset'),
            }}
            testids={{
              out: 'waveform-zoom-out',
              in: 'waveform-zoom-in',
              reset: 'waveform-zoom-reset',
            }}
          />
        </span>
      </div>
      {previewWave && preview ? (
        <Strip
          wave={previewWave}
          loading={source.loading}
          loudness={source.loudness}
          color={AFTER_COLOR}
          marks={marks}
          limitDb={preview.limitDb}
          background={source.wave}
          raster={OVERLAY_W}
          zoom={zoom}
          onZoomChange={setZoom}
          trimShade={trimShade}
        />
      ) : (
        <Strip
          {...source}
          color={AFTER_COLOR}
          clipDb={clipDb}
          marks={marks}
          split={split}
          raster={OVERLAY_W}
          zoom={zoom}
          onZoomChange={setZoom}
          inputPath={inputPath}
          trimShade={trimShade}
        />
      )}
    </div>
  )
}

// The source and converted files compared — side by side or overlaid, the legends
// (colour dot, label, measured figures) staying up in either view.
export function WaveformCompare({
  inputPath,
  outputPath,
  enabled,
  clipDb,
}: {
  inputPath: string
  outputPath: string
  enabled: boolean
  clipDb?: number
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [view, setView] = useState<CompareView>('side')
  // Split L/R lanes for the side-by-side strips. Not offered overlaid: that view
  // already stacks two envelopes, and four lanes would be unreadable.
  const [split, setSplit] = useState(false)
  const before = useStripData(inputPath, enabled)
  const after = useStripData(outputPath, enabled)
  const viewButton = (id: CompareView, label: string, Icon: typeof Columns2): React.JSX.Element => (
    <button
      type="button"
      data-testid={`waveform-view-${id}`}
      aria-label={label}
      aria-pressed={view === id}
      onClick={() => setView(id)}
      className={`press group relative flex h-5 w-6 items-center justify-center rounded ${
        view === id ? 'bg-[var(--color-panel-2)] text-fg' : 'text-fg-dim hover:text-fg'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <Tooltip label={label} align="end" />
    </button>
  )
  return (
    <div data-testid="waveform-compare" className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <Legend
            testid="waveform-before"
            color={BEFORE_COLOR}
            label={tr('editor.waveformBefore')}
            loudness={before.loudness}
          />
          <Legend
            testid="waveform-after"
            color={AFTER_COLOR}
            label={tr('editor.waveformAfter')}
            loudness={after.loudness}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {view === 'side' &&
            (before.wave?.channels?.length === 2 || after.wave?.channels?.length === 2) && (
              <button
                type="button"
                data-testid="waveform-split"
                aria-label={tr('editor.waveformSplit')}
                aria-pressed={split}
                onClick={() => setSplit((s) => !s)}
                className={`press flex h-5 w-5 items-center justify-center rounded ${
                  split ? 'bg-[var(--color-panel-2)] text-fg' : 'text-fg-dim hover:text-fg'
                }`}
              >
                <Rows2 className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          <div className="flex shrink-0 gap-0.5 rounded-md bg-[var(--color-field)] p-0.5">
            {viewButton('side', tr('editor.waveformViewSide'), Columns2)}
            {viewButton('overlay', tr('editor.waveformViewOverlay'), Layers2)}
          </div>
        </div>
      </div>
      {view === 'side' ? (
        <div data-testid="waveform-side" className="grid grid-cols-2 gap-2">
          <Strip {...before} color={BEFORE_COLOR} clipDb={clipDb} split={split} />
          <Strip {...after} color={AFTER_COLOR} clipDb={clipDb} split={split} />
        </div>
      ) : (
        <OverlayStrip before={before} after={after} />
      )}
    </div>
  )
}
