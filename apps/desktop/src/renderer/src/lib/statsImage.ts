import type { LifetimeStats } from '../../../shared/types'

// Same fixed dark palette as the quality report (lib/qualityReport.ts): a PNG shared on
// Instagram must look the same from every install, whatever theme the sender uses.
const CARD = {
  bg: '#16161e',
  panel: '#1a1b26',
  line: 'rgba(192, 202, 245, 0.16)',
  fg: '#c0caf5',
  fgDim: '#969cbd',
  accent: '#7aa2f7',
} as const

// Instagram story canvas: 9:16 at 1080×1920 is the size stories neither crop nor scale.
const WIDTH = 1080
const HEIGHT = 1920
const PAD = 96

// The StatsTab grid order, so the card and the tab tell the story in the same sequence.
const CELL_ORDER: (keyof LifetimeStats)[] = [
  'imported',
  'listened',
  'analyzed',
  'discogsMatches',
  'bandcampMatches',
  'deezerMatches',
]

interface StatsImageCell {
  key: keyof LifetimeStats
  value: number
}

// Four fills two clean rows of the card's two-column grid; six leaves a lopsided third.
const MAX_CELLS = 4

// The share card is a brag sheet, not a report. Zero tallies are dropped — "0 found on
// Bandcamp" reads as an anti-achievement — and then only the four biggest survive.
//
// Biggest rather than a relative floor: a percentage cut looked right until measured
// against real numbers, where Bandcamp (1.8% of the top tally) belongs on the card and
// tracks-played (1.6%) does not. Nothing separates those two by size, so ranking picks
// the four that carry the most weight and leaves the tail off instead of inventing a
// threshold the data does not support. CELL_ORDER still decides the reading order, so
// the card and the Stats tab tell the story in the same sequence.
export function statsImageCells(stats: LifetimeStats): StatsImageCell[] {
  const active = CELL_ORDER.filter((key) => stats[key] > 0)
  const kept = new Set(
    [...active].sort((a, b) => stats[b] - stats[a]).slice(0, MAX_CELLS),
  )
  return active.filter((key) => kept.has(key)).map((key) => ({ key, value: stats[key] }))
}

interface StatsImageInput {
  title: string
  // 0 hides the hero block (activity without conversions still deserves a card).
  conversionCount: number
  countLabel: string
  // Already filtered (statsImageCells) and translated by the caller.
  cells: { value: number; label: string }[]
  timeSaved: string | null
  perTrack: string | null
  footer: string
}

// Concentric record grooves fanning out of a corner — the app's namesake as the card's
// only decoration, faint enough to sit behind text without a legibility guard.
function grooves(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  for (let r = 220, i = 0; r <= 660; r += 34, i++) {
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(122, 162, 247, 0.14)' : 'rgba(122, 162, 247, 0.06)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
}

// Composes the shareable stats card as a story-sized PNG: wordmark and title up top, the
// lifetime conversion hero, the activity tallies in a grid, the time-saved panel, and the
// site call to action. Returns a data URL ready for the save dialog.
//
// The milestone bar the Stats tab shows is deliberately absent: "2583 to go until 25000"
// motivates the person converting, but says nothing to whoever sees the card on Instagram,
// which is half of what this image is for.
export function renderStatsImage(input: StatsImageInput): string {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('stats image: no 2d context')

  ctx.fillStyle = CARD.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  grooves(ctx, WIDTH + 60, -60)
  grooves(ctx, -60, HEIGHT + 60)

  const centerX = WIDTH / 2
  ctx.textAlign = 'center'

  let y = 230
  ctx.fillStyle = CARD.accent
  ctx.font = '600 42px system-ui, sans-serif'
  ctx.letterSpacing = '12px'
  // Half the trailing letter-space back, so the spaced wordmark still looks centered.
  ctx.fillText('SURCO', centerX + 6, y)
  ctx.letterSpacing = '0px'

  y += 88
  ctx.fillStyle = CARD.fg
  ctx.font = '600 58px system-ui, sans-serif'
  ctx.fillText(input.title, centerX, y, WIDTH - PAD * 2)

  if (input.conversionCount > 0) {
    y += 286
    ctx.font = '700 220px system-ui, sans-serif'
    ctx.fillText(String(input.conversionCount), centerX, y, WIDTH - PAD * 2)
    y += 78
    ctx.fillStyle = CARD.fgDim
    ctx.font = '34px system-ui, sans-serif'
    ctx.fillText(input.countLabel, centerX, y)

  }

  // Two-column tally grid; an odd last cell sits centered on its own row.
  if (input.cells.length > 0) {
    y += 130
    const colOffset = 240
    for (let i = 0; i < input.cells.length; i += 2) {
      const row = input.cells.slice(i, i + 2)
      row.forEach((cell, j) => {
        const x = row.length === 1 ? centerX : centerX + (j === 0 ? -colOffset : colOffset)
        ctx.fillStyle = CARD.fg
        ctx.font = '600 66px system-ui, sans-serif'
        ctx.fillText(String(cell.value), x, y)
        ctx.fillStyle = CARD.fgDim
        ctx.font = '27px system-ui, sans-serif'
        ctx.fillText(cell.label, x, y + 46, colOffset * 2 - 40)
      })
      y += 172
    }
    y -= 172
  }

  if (input.timeSaved) {
    y += 128
    const panelHeight = input.perTrack ? 186 : 136
    ctx.fillStyle = CARD.panel
    ctx.strokeStyle = CARD.line
    ctx.beginPath()
    ctx.roundRect(PAD, y, WIDTH - PAD * 2, panelHeight, 24)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = CARD.fg
    ctx.font = '600 46px system-ui, sans-serif'
    ctx.fillText(input.timeSaved, centerX, y + 82, WIDTH - PAD * 2 - 60)
    if (input.perTrack) {
      ctx.fillStyle = CARD.fgDim
      ctx.font = '26px system-ui, sans-serif'
      ctx.fillText(input.perTrack, centerX, y + 138, WIDTH - PAD * 2 - 60)
    }
    y += panelHeight
  }

  // The footer is the only thing that can turn a viewer into a user, so it reads as a
  // button rather than as the dimmest text on the card, which is what it used to be.
  const ctaFont = '600 30px system-ui, sans-serif'
  ctx.font = ctaFont
  const ctaWidth = Math.min(WIDTH - PAD * 2, ctx.measureText(input.footer).width + 76)
  const ctaHeight = 76
  const ctaY = Math.min(HEIGHT - 196, y + 150)
  ctx.fillStyle = 'rgba(122, 162, 247, 0.12)'
  ctx.strokeStyle = 'rgba(122, 162, 247, 0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(centerX - ctaWidth / 2, ctaY, ctaWidth, ctaHeight, ctaHeight / 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = CARD.accent
  ctx.font = ctaFont
  ctx.textBaseline = 'middle'
  ctx.fillText(input.footer, centerX, ctaY + ctaHeight / 2 + 1)
  ctx.textBaseline = 'alphabetic'

  return canvas.toDataURL('image/png')
}
