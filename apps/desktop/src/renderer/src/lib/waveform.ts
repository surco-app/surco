import type { NormalizeConfig } from '../../../shared/types'

// Tokyo Night's danger red, hardcoded like the strips' blue/grey: the canvas raster
// can't read CSS variables, and the strips don't retheme either.
const CLIP_COLOR = 'rgba(247, 118, 142, 0.95)'

// Peaks are absolute (1.0 = 0 dBFS, see main/waveform.ts), so a dB ceiling converts
// straight to a linear amplitude. Strictly above: a normalized output sitting exactly
// AT its ceiling is compliant, not clipping.
function clipsOver(amp: number, clipDb: number): boolean {
  return amp > 10 ** (clipDb / 20)
}

// How many peak buckets poke over the ceiling — the legend's cue to show (and the
// tests' way to assert) the red marks drawWaveform paints.
export function clippedCount(peaks: number[], clipDb: number): number {
  return peaks.filter((p) => clipsOver(p, clipDb)).length
}

// The normalization preview: the envelope after the mode's linear gain, plus the dB
// line its limiter would hold (drawWaveform's limitDb clamps and marks the bars that
// hit it). Loudness needs the measured integrated LUFS to size the gain; peak mode
// only needs the decode itself. Null when there is nothing honest to predict.
export function previewPeaks(
  peaks: number[],
  cfg: NormalizeConfig,
  integratedLufs: number | null | undefined,
): { peaks: number[]; limitDb: number; gainDb: number } | null {
  if (cfg.mode === 'peak') {
    const max = peaks.reduce((m, p) => (p > m ? p : m), 0)
    if (max <= 0) return null
    const gainDb = cfg.peakDb - 20 * Math.log10(max)
    const gain = 10 ** (gainDb / 20)
    // The red line is digital clipping, not the target: scaling the loudest sample
    // TO the target means nothing ever exceeds the target by construction. Against
    // 0 dBFS the marks appear exactly when a past-full-scale target would clip.
    return { peaks: peaks.map((p) => p * gain), limitDb: 0, gainDb }
  }
  if (cfg.mode === 'loudness') {
    if (integratedLufs == null || !Number.isFinite(integratedLufs)) return null
    const gainDb = cfg.targetLufs - integratedLufs
    const gain = 10 ** (gainDb / 20)
    return { peaks: peaks.map((p) => p * gain), limitDb: cfg.truePeakDb, gainDb }
  }
  return null
}

// Draws the mirrored peak-bar strip onto the canvas's own raster (scaled by CSS to
// the container). Shared by the player's scrubbable strip and the editor's
// before/after comparison so the two render the same envelope identically.
// `clear: false` lets the comparison's overlaid view stack a second envelope on
// top of the first instead of wiping it. With `clipDb`, bars poking over that dB
// ceiling paint red — where a limiter will act. With `limitDb` (the preview), bars
// are also CLAMPED at that line, so the strip shows the limited outcome while the
// red still says "the limiter acted here". With `clipped` (and no dB line), red
// follows the decoder's per-bucket true-clipping flags instead — the envelope can't
// tell a pinned sample from loud mastering, only the native-rate scan can. `marks:
// false` keeps the clamp but paints everything the base color — the legend's
// toggle switches the red off without un-limiting the drawn outcome. `lane` confines
// the mirrored wave to one horizontal slice of the canvas — the split L/R view is
// two calls stacking Audacity-style lanes on the one raster.
export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  opts: {
    color?: string
    clear?: boolean
    clipDb?: number
    clipped?: boolean[]
    lane?: { index: number; count: number }
    limitDb?: number
    marks?: boolean
    // Draw only this slice of the peak array (0..1 fractions of it), stretched
    // across the full canvas — the deep zoom's viewport canvas renders the
    // visible window this way instead of rastering the whole zoomed strip.
    window?: { from: number; to: number }
  } = {},
): void {
  const ctx = canvas.getContext('2d')
  // jsdom (tests) has no 2D context; the strips assert their geometry via the DOM.
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  if (opts.clear !== false) ctx.clearRect(0, 0, w, h)
  const laneH = opts.lane ? h / opts.lane.count : h
  const mid = (opts.lane ? laneH * opts.lane.index : 0) + laneH / 2
  const baseColor = opts.color ?? 'rgba(96, 165, 250, 0.8)'
  const limitLin = opts.limitDb !== undefined ? 10 ** (opts.limitDb / 20) : null
  const from = (opts.window?.from ?? 0) * peaks.length
  const to = (opts.window?.to ?? 1) * peaks.length
  const span = to - from
  if (span <= 0) return
  const barW = w / span
  for (let i = Math.max(0, Math.floor(from)); i < Math.min(peaks.length, Math.ceil(to)); i++) {
    const over =
      opts.marks !== false &&
      (limitLin !== null
        ? peaks[i] > limitLin
        : opts.clipDb !== undefined
          ? clipsOver(peaks[i], opts.clipDb)
          : opts.clipped?.[i] === true)
    const amp = limitLin !== null ? Math.min(peaks[i], limitLin) : peaks[i]
    const bar = Math.max(amp * (laneH / 2 - 2), 0.5)
    ctx.fillStyle = over ? CLIP_COLOR : baseColor
    ctx.fillRect((i - from) * barW, mid - bar, Math.max(barW - 0.5, 0.5), bar * 2)
  }
}

// A synthetic amplitude envelope for the decode placeholder. Real music swells and
// dips, so a row of equal bars (the old repeating gradient) read as fake. We blend a
// slow macro envelope (track dynamics) with a per-bar jitter (transient detail), both
// seeded by index so the shape is deterministic — it never reflows while it pulses,
// and tests can assert it. Kept in 0.08..1 so every bar stays visible on the strip.
export function skeletonPeaks(count: number): number[] {
  const peaks: number[] = []
  for (let i = 0; i < count; i++) {
    const t = i / count
    const macro = 0.55 + 0.3 * Math.sin(t * Math.PI * 3 + 0.6) + 0.12 * Math.sin(t * Math.PI * 11)
    const seeded = Math.sin(i * 12.9898) * 43758.5453
    const jitter = seeded - Math.floor(seeded)
    peaks.push(Math.min(1, Math.max(0.08, macro * (0.55 + 0.5 * jitter))))
  }
  return peaks
}
