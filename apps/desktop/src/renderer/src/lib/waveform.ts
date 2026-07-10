// Draws the mirrored peak-bar strip onto the canvas's own raster (scaled by CSS to
// the container). Shared by the player's scrubbable strip and the editor's
// before/after comparison so the two render the same envelope identically.
export function drawWaveform(canvas: HTMLCanvasElement, peaks: number[]): void {
  const ctx = canvas.getContext('2d')
  // jsdom (tests) has no 2D context; the strips assert their geometry via the DOM.
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const mid = h / 2
  ctx.fillStyle = 'rgba(96, 165, 250, 0.8)'
  const barW = w / peaks.length
  for (let i = 0; i < peaks.length; i++) {
    const bar = Math.max(peaks[i] * (h / 2 - 2), 0.5)
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
