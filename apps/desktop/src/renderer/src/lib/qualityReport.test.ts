// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import { applyDuotone, duotoneLut, renderQualityReport, reportVerdictColor } from './qualityReport'

describe('duotoneLut', () => {
  // feComponentTransfer type="table" semantics: the table holds [0,1] stops evenly spread
  // over the gray range, interpolated linearly between neighbours. The LUT must reproduce
  // that mapping per 8-bit level so the exported PNG matches the on-screen SVG recolor.
  it('expands a two-stop identity table to a linear 256-entry lut', () => {
    const lut = duotoneLut({ r: '0 1', g: '0 1', b: '0 1' })
    expect(lut.r[0]).toBe(0)
    expect(lut.r[255]).toBe(255)
    expect(lut.g[128]).toBe(128)
  })

  it('interpolates between inner table stops', () => {
    // Three stops 0 → 1 → 0: mid-gray hits the peak, the ends sit at 0.
    const lut = duotoneLut({ r: '0 1 0', g: '0 1 0', b: '0 1 0' })
    expect(lut.r[0]).toBe(0)
    expect(lut.r[255]).toBe(0)
    expect(lut.r[128]).toBeGreaterThan(250)
  })
})

describe('applyDuotone', () => {
  // The spectrogram arrives as grayscale; recoloring maps each pixel's gray level through
  // the per-channel LUTs, leaving alpha untouched — the same transform the SVG filter does.
  it('maps gray levels through the lut channels and keeps alpha', () => {
    const lut = {
      r: new Uint8ClampedArray(256).fill(10),
      g: new Uint8ClampedArray(256).fill(20),
      b: new Uint8ClampedArray(256).fill(30),
    }
    lut.r[255] = 200
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128])
    applyDuotone(data, lut)
    expect([...data]).toEqual([10, 20, 30, 255, 200, 20, 30, 128])
  })
})

describe('reportVerdictColor', () => {
  // The report uses a fixed dark palette (not the live theme) so a shared PNG looks the
  // same everywhere; the verdict tone maps to the same token colors the badge uses.
  it('maps each verdict tone to its fixed badge color', () => {
    expect(reportVerdictColor('good')).toBe('#9ece6a')
    expect(reportVerdictColor('warn')).toBe('#e0af68')
    expect(reportVerdictColor('bad')).toBe('#f7768e')
    expect(reportVerdictColor('processed')).toBe('#e0af68')
  })
})

// jsdom draws nothing, so each canvas gets a context that only records what it is asked
// to paint, with the paint state at that moment. measureText gives every character 8 px,
// which makes the wrapping predictable: the report's text column is 1104 px, 138 characters.
interface Op {
  canvas: HTMLCanvasElement
  name: string
  args: unknown[]
  fillStyle: unknown
}

const CHAR_WIDTH = 8
const BROKEN_IMAGE = 'data:image/png;base64,BROKEN'
const GRAY_PIXELS = [0, 0, 0, 255, 255, 255, 255, 255]
let ops: Op[] = []

function recordingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      ops.push({ canvas, name, args, fillStyle: ctx.fillStyle })
    }
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }) as TextMetrics,
    getImageData: (_x: number, _y: number, width: number, height: number) =>
      ({ data: new Uint8ClampedArray(GRAY_PIXELS), width, height }) as ImageData,
    putImageData: (image: ImageData) => record('putImageData')([...image.data]),
    fillText: record('fillText'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    drawImage: record('drawImage'),
    beginPath: record('beginPath'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    stroke: record('stroke'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    setLineDash: record('setLineDash'),
  }
  return ctx as CanvasRenderingContext2D
}

class LoadingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 2
  naturalHeight = 1
  set src(value: string) {
    queueMicrotask(() => (value === BROKEN_IMAGE ? this.onerror?.() : this.onload?.()))
  }
}

function texts(): { text: string; x: number; y: number; fillStyle: unknown }[] {
  return ops
    .filter((op) => op.name === 'fillText')
    .map((op) => ({
      text: String(op.args[0]),
      x: Number(op.args[1]),
      y: Number(op.args[2]),
      fillStyle: op.fillStyle,
    }))
}

function textY(text: string): number {
  const found = texts().find((t) => t.text === text)
  if (!found) throw new Error(`"${text}" was not drawn`)
  return found.y
}

function reportCanvas(): HTMLCanvasElement {
  const op = ops.find((o) => o.canvas.width === 1200)
  if (!op) throw new Error('nothing was drawn on the report canvas')
  return op.canvas
}

const spectrum: SpectrumResult = {
  image: 'data:image/png;base64,SPECTROGRAM',
  cutoffHz: 16000,
  sampleRateHz: 44100,
  processed: false,
}

const input = {
  spectrum,
  heading: 'Burial — Archangel',
  facts: 'MP3 · 44.1 kHz',
  verdict: 'bad' as const,
  verdictLabel: 'Fake lossless',
  cutoffLabel: '16 kHz',
  caption: 'Cut at 16 kHz.',
  notes: [],
  footer: 'surco.app',
}

beforeEach(() => {
  ops = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return recordingContext(this)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,REPORT')
  vi.stubGlobal('Image', LoadingImage)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('renderQualityReport', () => {
  // The PNG goes straight to the save dialog and from there to a forum post, so what
  // comes back must be the report canvas encoded as PNG, not a placeholder.
  it('returns the report canvas as a PNG data URL', async () => {
    const url = await renderQualityReport(input)
    expect(url).toBe('data:image/png;base64,REPORT')
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png')
    expect(reportCanvas().width).toBe(1200)
  })

  // Whoever sees the image in a thread has nothing else: the track, its format and the
  // verdict must all be on it, and the verdict in its tone so red reads as bad at a glance.
  it('draws the heading, the facts and the verdict in its own colour', async () => {
    await renderQualityReport(input)
    const drawn = texts()
    expect(drawn.map((t) => t.text)).toEqual(
      expect.arrayContaining(['Burial — Archangel', 'MP3 · 44.1 kHz', 'surco.app']),
    )
    expect(drawn.find((t) => t.text === 'Fake lossless')?.fillStyle).toBe(reportVerdictColor('bad'))
  })

  // The shared image must look like the editor's spectrum, so the grayscale analysis is
  // recoloured through the fixed ramp (floor = panel, peak = warn) before it is placed.
  it('recolours the spectrogram before drawing it into the report', async () => {
    await renderQualityReport(input)
    const recolor = ops.findIndex((op) => op.name === 'putImageData')
    expect(ops[recolor].args[0]).toEqual([26, 27, 38, 255, 224, 175, 104, 255])
    const placed = ops.findIndex(
      (op) => op.name === 'drawImage' && op.args[0] === ops[recolor].canvas,
    )
    expect(placed).toBeGreaterThan(recolor)
    expect(ops[placed].canvas).toBe(reportCanvas())
    expect(ops[placed].args.slice(1)).toEqual([48, 104, 1104, 440])
  })

  // The justification is what makes the badge credible, so it is wrapped to the text
  // column word by word, never cut or squeezed, with the notes after it.
  // Fourteen of these words come to 139 characters, one past the column, and the note is
  // exactly 138, so both edges of the rule are pinned.
  it('wraps the caption and the notes to the text column', async () => {
    const word = 'aaaaaaaaa'
    const caption = Array(23).fill(word).join(' ')
    const exactFit = `${'a'.repeat(69)} ${'a'.repeat(68)}`
    await renderQualityReport({ ...input, caption, notes: ['Upsampled.', exactFit] })
    const body = texts().filter((t) => t.text.startsWith('a') || t.text === 'Upsampled.')
    expect(body.map((t) => t.text.split(' ').length)).toEqual([13, 10, 1, 2])
    expect(body.every((t) => t.text.length * CHAR_WIDTH <= 1104)).toBe(true)
    expect(body.map((t) => t.text).join(' ')).toBe(`${caption} Upsampled. ${exactFit}`)
  })

  // A long justification must neither run off the bottom of the PNG nor leave an empty
  // band under a short one: each wrapped line adds exactly one line of height.
  it('grows the canvas by exactly the wrapped lines', async () => {
    await renderQualityReport(input)
    const short = { height: reportCanvas().height, footerY: textY('surco.app') }
    ops = []
    const long = Array(23).fill('aaaaaaaaa').join(' ')
    await renderQualityReport({ ...input, caption: long, notes: ['Upsampled.'] })
    const tall = { height: reportCanvas().height, footerY: textY('surco.app') }
    expect(tall.height - short.height).toBe(2 * 24)
    expect(tall.height - tall.footerY).toBe(short.height - short.footerY)
    expect(tall.footerY).toBeLessThan(tall.height)
  })

  // A mark above the image's top frequency would sit off the image or claim content the
  // picture cannot show; a 32 kHz file tops out at 16 kHz, so it has no 20k mark.
  it('marks frequencies only up to the top of the spectrum, rising up the image', async () => {
    await renderQualityReport({ ...input, spectrum: { ...spectrum, sampleRateHz: 32000 } })
    const marks = texts().filter((t) => /^\d+k$/.test(t.text))
    expect(marks.map((m) => m.text)).toEqual(['0k', '5k', '10k', '15k'])
    const ys = marks.map((m) => m.y)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)
  })

  // Without a sample rate there is no axis, and marks or a cutoff line on it would be
  // invented readings.
  it('draws no marks and no cutoff line when the spectrum has no top frequency', async () => {
    await renderQualityReport({ ...input, spectrum: { ...spectrum, sampleRateHz: 0 } })
    expect(texts().some((t) => /^\d+k$/.test(t.text) || t.text === '16 kHz')).toBe(false)
    expect(ops.some((op) => op.name === 'setLineDash')).toBe(false)
  })

  // The dashed line is where the verdict comes from, drawn across the whole image at the
  // cutoff's height with its pill, the same annotation the editor shows.
  it('draws the cutoff line across the image with its label', async () => {
    await renderQualityReport(input)
    const lineY = 104 + (1 - 16000 / 22050) * 440
    expect(ops.find((op) => op.name === 'moveTo')?.args).toEqual([48, lineY])
    expect(ops.find((op) => op.name === 'lineTo')?.args).toEqual([1152, lineY])
    expect(texts().some((t) => t.text === '16 kHz')).toBe(true)
  })

  // A line without its pill is an unexplained stroke across the music, and a pill without
  // a measured cutoff has nowhere true to sit, so both are needed for either to appear.
  it.each([
    ['no cutoff was measured', { cutoffHz: null }, '16 kHz'],
    ['the cutoff has no label', {}, null],
  ])('draws no cutoff line when %s', async (_case, spectrumPatch, cutoffLabel) => {
    await renderQualityReport({
      ...input,
      spectrum: { ...spectrum, ...spectrumPatch },
      cutoffLabel,
    })
    expect(ops.some((op) => op.name === 'setLineDash' || op.name === 'moveTo')).toBe(false)
    expect(texts().some((t) => t.text === '16 kHz')).toBe(false)
  })

  // The save flow catches this and tells the user; a report with a blank image instead
  // of the spectrogram would be shared as if it were evidence.
  it('rejects when the spectrogram image fails to load', async () => {
    await expect(
      renderQualityReport({ ...input, spectrum: { ...spectrum, image: BROKEN_IMAGE } }),
    ).rejects.toThrow('quality report: spectrogram image failed to load')
    expect(ops).toEqual([])
  })
})
