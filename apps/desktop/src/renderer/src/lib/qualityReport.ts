import type { SpectrumResult } from '../../../shared/types'
import type { Verdict } from './quality'
import { parseColor, type Ramp, spectrumRampTable } from './spectrumColors'

// The exported report uses a FIXED dark palette (the dark theme's tokens) instead of the
// live theme: a PNG shared in a forum must look the same from every install, and the dark
// ramp is the one that reads like the familiar spectral tools. Values mirror index.css.
const REPORT = {
  bg: '#16161e',
  panel: '#1a1b26',
  line: 'rgba(192, 202, 245, 0.16)',
  fg: '#c0caf5',
  fgDim: '#969cbd',
  accent: '#7aa2f7',
  good: '#9ece6a',
  warn: '#e0af68',
  danger: '#f7768e',
} as const

// The same panel→accent→warn ramp the on-screen SVG filter uses, on the fixed palette.
const REPORT_RAMP: Ramp = spectrumRampTable(
  [REPORT.panel, REPORT.accent, REPORT.warn].map(parseColor),
)

export function reportVerdictColor(verdict: Verdict): string {
  if (verdict === 'good') return REPORT.good
  if (verdict === 'warn') return REPORT.warn
  return REPORT.danger
}

interface DuotoneLut {
  r: Uint8ClampedArray
  g: Uint8ClampedArray
  b: Uint8ClampedArray
}

// Expands a feComponentTransfer-style table (space-separated [0,1] stops, linearly
// interpolated) into a per-8-bit-level lookup, so the canvas recolor reproduces exactly
// what the SVG filter shows on screen.
export function duotoneLut(ramp: Ramp): DuotoneLut {
  const channel = (table: string): Uint8ClampedArray => {
    const stops = table.split(' ').map(Number)
    const out = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      const pos = (v / 255) * (stops.length - 1)
      const i = Math.min(Math.floor(pos), stops.length - 2)
      const t = pos - i
      out[v] = Math.round((stops[i] + (stops[i + 1] - stops[i]) * t) * 255)
    }
    return out
  }
  return { r: channel(ramp.r), g: channel(ramp.g), b: channel(ramp.b) }
}

// Recolors grayscale RGBA pixels in place: each pixel's gray level (the red channel — the
// source image is grayscale, so the channels agree) maps through the per-channel LUTs.
// Alpha is untouched.
export function applyDuotone(data: Uint8ClampedArray, lut: DuotoneLut): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    data[i] = lut.r[gray]
    data[i + 1] = lut.g[gray]
    data[i + 2] = lut.b[gray]
  }
}

interface QualityReportInput {
  spectrum: SpectrumResult
  // "Artist — Title" (or the file name when untagged) — the report's headline.
  heading: string
  // Short technical line under the heading: extension, sample rate.
  facts: string
  verdict: Verdict
  verdictLabel: string
  // The cutoff/highs pill text drawn on the spectrogram's marker line.
  cutoffLabel: string | null
  // The verdict's justification paragraph, wrapped under the image.
  caption: string
  // The amber upsample note, when the analysis flagged one.
  upsampledNote?: string
  footer: string
}

const WIDTH = 1200
const PAD = 48
const IMAGE_HEIGHT = 440
const FREQ_MARKS = [0, 5000, 10000, 15000, 20000]

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

// Draws a rounded pill with centered text, returning nothing — a tiny shared shape for
// the verdict badge and the on-image frequency labels.
function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  align: 'left' | 'right',
): void {
  const padX = 10
  const height = 24
  const width = ctx.measureText(text).width + padX * 2
  const left = align === 'right' ? x - width : x
  ctx.fillStyle = REPORT.panel
  ctx.strokeStyle = REPORT.line
  ctx.beginPath()
  ctx.roundRect(left, y, width, height, 12)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, left + padX, y + height / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('quality report: spectrogram image failed to load'))
    img.src = src
  })
}

// Composes the shareable PNG: heading + verdict pill, the recolored spectrogram with its
// frequency marks and cutoff line (the same annotations the editor shows), the verdict's
// justification, and the product footer. Returns a data URL ready for the save dialog.
export async function renderQualityReport(input: QualityReportInput): Promise<string> {
  const { spectrum } = input
  const img = await loadImage(spectrum.image)

  // Recolor at the image's natural size on a scratch canvas, then scale into the report.
  const scratch = document.createElement('canvas')
  scratch.width = img.naturalWidth
  scratch.height = img.naturalHeight
  const sctx = scratch.getContext('2d')
  if (!sctx) throw new Error('quality report: no 2d context')
  sctx.drawImage(img, 0, 0)
  const pixels = sctx.getImageData(0, 0, scratch.width, scratch.height)
  applyDuotone(pixels.data, duotoneLut(REPORT_RAMP))
  sctx.putImageData(pixels, 0, 0)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('quality report: no 2d context')
  const contentWidth = WIDTH - PAD * 2

  // Measure the caption first so the canvas height fits the wrapped text exactly.
  ctx.font = '16px system-ui, sans-serif'
  const captionLines = wrapLines(ctx, input.caption, contentWidth)
  const noteLines = input.upsampledNote ? wrapLines(ctx, input.upsampledNote, contentWidth) : []
  const textBlock = (captionLines.length + noteLines.length) * 24
  const height = PAD + 56 + IMAGE_HEIGHT + 20 + textBlock + 56 + PAD / 2
  canvas.width = WIDTH
  canvas.height = height

  ctx.fillStyle = REPORT.bg
  ctx.fillRect(0, 0, WIDTH, height)

  // Header: heading left, verdict pill right, facts line under the heading.
  let y = PAD
  ctx.fillStyle = REPORT.fg
  ctx.font = '600 24px system-ui, sans-serif'
  ctx.fillText(input.heading, PAD, y, contentWidth - 220)
  ctx.font = '600 14px system-ui, sans-serif'
  pill(ctx, WIDTH - PAD, y - 18, input.verdictLabel, reportVerdictColor(input.verdict), 'right')
  y += 26
  ctx.fillStyle = REPORT.fgDim
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillText(input.facts, PAD, y)
  y += 30

  // The spectrogram, recolored, with the editor's same frequency marks and cutoff line.
  ctx.drawImage(scratch, PAD, y, contentWidth, IMAGE_HEIGHT)
  ctx.strokeStyle = REPORT.line
  ctx.strokeRect(PAD + 0.5, y + 0.5, contentWidth - 1, IMAGE_HEIGHT - 1)
  const nyquist = spectrum.sampleRateHz / 2
  ctx.font = '600 12px system-ui, sans-serif'
  if (nyquist > 0) {
    for (const f of FREQ_MARKS.filter((f) => f <= nyquist)) {
      pill(
        ctx,
        PAD + 8,
        y + (1 - f / nyquist) * IMAGE_HEIGHT - 12,
        `${f / 1000}k`,
        REPORT.fg,
        'left',
      )
    }
    if (spectrum.cutoffHz !== null && input.cutoffLabel) {
      const lineY = y + (1 - spectrum.cutoffHz / nyquist) * IMAGE_HEIGHT
      ctx.strokeStyle = REPORT.fgDim
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(PAD, lineY)
      ctx.lineTo(PAD + contentWidth, lineY)
      ctx.stroke()
      ctx.setLineDash([])
      pill(ctx, PAD + contentWidth - 8, lineY + 4, input.cutoffLabel, REPORT.fg, 'right')
    }
  }
  y += IMAGE_HEIGHT + 32

  // The verdict's justification — the caption the editor shows, so the badge never
  // stands alone in the shared image either.
  ctx.font = '16px system-ui, sans-serif'
  ctx.fillStyle = REPORT.fg
  for (const line of captionLines) {
    ctx.fillText(line, PAD, y)
    y += 24
  }
  ctx.fillStyle = REPORT.warn
  for (const line of noteLines) {
    ctx.fillText(line, PAD, y)
    y += 24
  }

  y += 24
  ctx.fillStyle = REPORT.fgDim
  ctx.font = '14px system-ui, sans-serif'
  ctx.fillText(input.footer, PAD, y)

  return canvas.toDataURL('image/png')
}
