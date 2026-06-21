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
