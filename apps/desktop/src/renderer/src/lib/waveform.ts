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

// Draws the mirrored peak-bar strip onto the canvas's own raster (scaled by CSS to
// the container). Shared by the player's scrubbable strip and the editor's
// before/after comparison so the two render the same envelope identically.
// `clear: false` lets the comparison's overlaid view stack a second envelope on
// top of the first instead of wiping it. With `clipDb`, bars poking over that dB
// ceiling paint red — where the track clips, or where a limiter will act.
export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  opts: { color?: string; clear?: boolean; clipDb?: number } = {},
): void {
  const ctx = canvas.getContext('2d')
  // jsdom (tests) has no 2D context; the strips assert their geometry via the DOM.
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  if (opts.clear !== false) ctx.clearRect(0, 0, w, h)
  const mid = h / 2
  const baseColor = opts.color ?? 'rgba(96, 165, 250, 0.8)'
  const barW = w / peaks.length
  for (let i = 0; i < peaks.length; i++) {
    const bar = Math.max(peaks[i] * (h / 2 - 2), 0.5)
    ctx.fillStyle =
      opts.clipDb !== undefined && clipsOver(peaks[i], opts.clipDb) ? CLIP_COLOR : baseColor
    ctx.fillRect(i * barW, mid - bar, Math.max(barW - 0.5, 0.5), bar * 2)
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
