import type { DockIconFrames } from '../../../shared/types'

// The engraved squiggle from build/icon.svg, verbatim: the resting frame must
// reproduce the shipped icon exactly so pausing never visibly swaps the design.
export const RESTING_WAVE_D = 'M431 512 C 455 447, 479 447, 503 512 S 551 577, 575 512 L 593 512'

const WAVE_START_X = 431
const WAVE_END_X = 593
const WAVE_CENTER_Y = 512
const WAVE_PERIOD = 144
const WAVE_AMPLITUDE = 50
// Pixels over which each end eases back to the centerline, so no frame ends with
// the round-capped stroke cut mid-oscillation.
const WAVE_TAPER = 24
const SAMPLE_STEP = 6

export function wavePathD(phase: number): string {
  const points: string[] = []
  for (let x = WAVE_START_X; x <= WAVE_END_X; x += SAMPLE_STEP) {
    const taper = Math.min(1, (x - WAVE_START_X) / WAVE_TAPER, (WAVE_END_X - x) / WAVE_TAPER)
    const angle = ((x - WAVE_START_X) / WAVE_PERIOD) * 2 * Math.PI - phase
    const y = WAVE_CENTER_Y - WAVE_AMPLITUDE * taper * Math.sin(angle)
    points.push(`${x} ${Math.round(y * 10) / 10}`)
  }
  return `M ${points.join(' L ')}`
}

// build/icon.svg with the engraved wave swapped for the given path, so every
// frame keeps the exact tile, disc and label the shipped icon was rendered from.
export function dockIconSvg(waveD: string): string {
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="tile" cx="0.32" cy="0.24" r="1.0">
      <stop offset="0" stop-color="#2A2E42"/>
      <stop offset="0.55" stop-color="#1A1B26"/>
      <stop offset="1" stop-color="#14141C"/>
    </radialGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.10"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="disc" cx="0.42" cy="0.36" r="0.85">
      <stop offset="0" stop-color="#23263A"/>
      <stop offset="0.55" stop-color="#131520"/>
      <stop offset="1" stop-color="#07080C"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3A4060"/>
      <stop offset="1" stop-color="#07080C"/>
    </linearGradient>
    <radialGradient id="label" cx="0.4" cy="0.34" r="0.9">
      <stop offset="0" stop-color="#CFE4FF"/>
      <stop offset="0.6" stop-color="#9ED7FF"/>
      <stop offset="1" stop-color="#6F9BEC"/>
    </radialGradient>
  </defs>

  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#tile)"/>
  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#gloss)"/>

  <circle cx="512" cy="512" r="300" fill="url(#rim)"/>
  <circle cx="512" cy="512" r="294" fill="url(#disc)"/>
  <g fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="3">
    <circle cx="512" cy="512" r="268"/>
    <circle cx="512" cy="512" r="244"/>
    <circle cx="512" cy="512" r="220"/>
    <circle cx="512" cy="512" r="196"/>
  </g>

  <circle cx="512" cy="512" r="136" fill="url(#label)"/>
  <path d="${waveD}"
        fill="none" stroke="#0B1430" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`
}

const FRAME_COUNT = 12
// Matches the Dock's retina raster; larger only costs IPC payload, smaller blurs.
const RASTER_SIZE = 512

async function rasterize(svg: string): Promise<string> {
  const img = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = (): void => resolve()
    img.onerror = (): void => reject(new Error('dock icon SVG failed to load'))
  })
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
  await loaded
  const canvas = document.createElement('canvas')
  canvas.width = RASTER_SIZE
  canvas.height = RASTER_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.drawImage(img, 0, 0, RASTER_SIZE, RASTER_SIZE)
  return canvas.toDataURL('image/png')
}

// PNG frames for app.dock.setIcon: main has no DOM, so the renderer rasterizes
// the SVG once and ships data URLs over IPC.
export async function generateDockIconFrames(): Promise<DockIconFrames> {
  const resting = await rasterize(dockIconSvg(RESTING_WAVE_D))
  const frames: string[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    frames.push(await rasterize(dockIconSvg(wavePathD((i / FRAME_COUNT) * 2 * Math.PI))))
  }
  return { resting, frames }
}
