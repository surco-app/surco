import { parseColor, spectrumRampTable } from '../../../desktop/src/renderer/src/lib/spectrumColors'
import css from '../index.css?raw'

// The app's own spectrogram ramp (with its low end sunk into the ground) over the site's
// light tokens, ending in the ink where the app ends in amber: these images are colored for
// the dark page and their low band is near white, so an amber top end painted it as a strip
// of mud. Surco draws its charts in accent and ink and keeps amber for states. Read from index.css when the module loads, so the
// prerendered page ships the filter already tuned and the light page never shows the dark
// image first.
const light = css.slice(css.indexOf('[data-theme="light"]'))
const token = (name: string): string =>
  light.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? ''

export const LIGHT_SPECTRUM_RAMP = spectrumRampTable(
  ['spectrum', 'blue', 'fg'].map((name) => parseColor(token(name))),
)
