// The spectrogram image is generated as a grayscale intensity map (loud = bright) and
// recolored in the renderer so it follows the active Tokyo Night theme. An SVG
// feComponentTransfer maps the gray value through a small per-channel table; building that
// table from theme tokens here keeps the color source in one place (index.css) and lets the
// image re-tint instantly on a theme switch without re-rendering with ffmpeg.

export type Rgb = readonly [number, number, number]
export type Ramp = { r: string; g: string; b: string }

export function parseColor(value: string): Rgb {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/)
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((p) => Number.parseInt(p, 10))
    return [r || 0, g || 0, b || 0]
  }
  return [0, 0, 0]
}

// feComponentTransfer reads each stop as a [0,1] value and interpolates linearly between
// them, so N stops give an (N-1)-segment ramp keyed on the gray input: stop 0 at black,
// the last stop at white.
export function rampTableValues(stops: Rgb[]): Ramp {
  const channel = (i: number): string => stops.map((s) => (s[i] / 255).toFixed(4)).join(' ')
  return { r: channel(0), g: channel(1), b: channel(2) }
}

// The bottom fraction of the gray range that fades to the floor (panel) color. Spek sinks
// its low end to black with `cf = level / 0.1` (spek-palette.cc) so faint noise reads as
// background while real signal above it keeps its hue; that is what makes a codec wall show
// as dead air instead of a colored haze. Our floor stop is panel-colored rather than black,
// so the fade needs to reach further up the range (0.30, tuned against a fake-320 wall, a
// genuine full-band master, and a real ~14 kHz-cut WAV) to pull the noise into the panel
// while leaving the −60…−90 dB HF transients that reach ~22 kHz visible.
const FLOOR_FRACTION = 0.3
// Enough samples that the linear interpolation between table entries follows the floor
// curve smoothly; the table is tiny, so density is free.
const TABLE_SIZE = 64

function lerp(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

// The same panel->accent->warn ramp as rampTableValues, but sampled into a dense table with
// Spek's low-end correction baked in: below FLOOR_FRACTION the color is scaled back toward
// the first stop (panel) so quiet noise sinks into the background. stops is [floor, mid, peak].
export function spectrumRampTable(stops: Rgb[]): Ramp {
  const [floor, mid, peak] = stops
  const rows: [number, number, number][] = []
  for (let i = 0; i < TABLE_SIZE; i++) {
    const t = i / (TABLE_SIZE - 1)
    const base = t < 0.5 ? lerp(floor, mid, t / 0.5) : lerp(mid, peak, (t - 0.5) / 0.5)
    const row =
      t < FLOOR_FRACTION ? lerp(floor, base, t / FLOOR_FRACTION) : base
    rows.push(row)
  }
  const channel = (c: number): string => rows.map((row) => (row[c] / 255).toFixed(4)).join(' ')
  return { r: channel(0), g: channel(1), b: channel(2) }
}
