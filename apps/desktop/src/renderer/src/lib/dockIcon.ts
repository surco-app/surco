import type { DockIconFrames } from '../../../shared/types'

// The engraved squiggle from build/icon.svg, verbatim: the resting frame must
// reproduce the shipped icon exactly so pausing never visibly swaps the design.
export const RESTING_WAVE_D = 'M423 512 C 449 440, 476 440, 502 512 S 555 584, 581 512 L 601 512'

// build/icon.svg with the label and engraving spun by `rotation` degrees about the
// record's center, so playback turns the vinyl like a turntable. The tile, the disc's
// shading and its lit edge stay put — only the label turns — so the light holds still
// and the motion reads as a spinning record, not a wobbling icon. The wave is the
// shipped engraving, unchanged: an LP shows the same mark coming round, it doesn't morph.
export function dockIconSvg(rotation = 0): string {
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="tile" cx="0.32" cy="0.24" r="1.0">
      <stop offset="0" stop-color="#14305C"/>
      <stop offset="0.55" stop-color="#0A1A38"/>
      <stop offset="1" stop-color="#050D1F"/>
    </radialGradient>
    <radialGradient id="disc" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#3466C2"/>
      <stop offset="0.6" stop-color="#2149A0"/>
      <stop offset="1" stop-color="#173678"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6F9FEC"/>
      <stop offset="0.5" stop-color="#2D5BB4" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#173678" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="label" cx="0.4" cy="0.34" r="0.9">
      <stop offset="0" stop-color="#A8D4FF"/>
      <stop offset="1" stop-color="#78B4F2"/>
    </radialGradient>
  </defs>

  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#tile)"/>

  <circle cx="512" cy="512" r="300" fill="url(#disc)"/>
  <circle cx="512" cy="512" r="295" fill="none" stroke="url(#rim)" stroke-width="10"/>
  <g transform="rotate(${rotation} 512 512)">
    <circle cx="512" cy="512" r="150" fill="url(#label)"/>
    <path d="${RESTING_WAVE_D}"
          fill="none" stroke="#0B1430" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`
}

// One full turn split across these frames; at the main loop's 100 ms cadence that's
// 1.8 s per revolution — an LP's 33⅓ rpm. More frames only smooth the spin at the
// cost of IPC payload and startup rasterization.
const FRAME_COUNT = 18
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
  const resting = await rasterize(dockIconSvg(0))
  const frames: string[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    frames.push(await rasterize(dockIconSvg((i / FRAME_COUNT) * 360)))
  }
  return { resting, frames }
}
