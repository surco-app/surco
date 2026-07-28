// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { beginNmlBatch, endNmlBatch, recordNmlPatch } from './nmlBatch'

const patch = (file: string) => ({ volume: 'HD', dir: '/:M:/', file })

describe('nmlBatch', () => {
  // Un lote de 300 pistas debe producir UNA escritura del NML, no 300: el fichero
  // es la colección entera y puede pesar decenas de MB.
  it('collects the patches of a batch and hands them over at once', () => {
    beginNmlBatch()
    recordNmlPatch(patch('uno.aiff'))
    recordNmlPatch(patch('dos.aiff'))

    expect(endNmlBatch()).toHaveLength(2)
  })

  // Terminar el lote lo vacía: un segundo cierre no puede reescribir el NML con los
  // patches del lote anterior, que ya se aplicaron.
  it('empties itself once ended', () => {
    beginNmlBatch()
    recordNmlPatch(patch('uno.aiff'))
    endNmlBatch()

    beginNmlBatch()
    expect(endNmlBatch()).toEqual([])
  })

  // A lone convert with no batch open around it still behaves like a batch of one:
  // begin/end wraps it, and its own end is the one that makes the patch visible.
  it('a lone begin/end outside any batch flushes its own patch', () => {
    beginNmlBatch()
    recordNmlPatch(patch('lone.wav'))

    expect(endNmlBatch()).toEqual([patch('lone.wav')])
  })

  // The regression this file exists to pin: processOne (⌘⏎ / the editor's convert
  // button) brackets every conversion with its own begin/end, and nothing stops it
  // firing while processAll's own batch is still open — the UI doesn't gate it and
  // there's no reentrancy guard in the renderer. If a nested begin reset the
  // accumulator, a single convert fired mid-batch would silently wipe every patch the
  // batch recorded before it. Reproduces the exact IPC order a reviewer observed:
  // BEGIN, batch0, BEGIN, lone, END, END.
  it('a nested begin/end during an open batch does not discard the outer batch patches', () => {
    beginNmlBatch()
    recordNmlPatch(patch('batch0.aiff'))
    beginNmlBatch()
    recordNmlPatch(patch('lone.wav'))
    // The inner end must not flush yet — the outer batch (started first) is still open.
    expect(endNmlBatch()).toEqual([])

    expect(endNmlBatch()).toEqual([patch('batch0.aiff'), patch('lone.wav')])
  })

  // A cancelled or throwing batch still calls end (via the renderer's finally), so
  // depth must not leak past that close and starve every batch that runs after it.
  it('an end always closes its begin, even after the batch it belonged to is done', () => {
    beginNmlBatch()
    recordNmlPatch(patch('cancelled.aiff'))
    endNmlBatch()

    beginNmlBatch()
    recordNmlPatch(patch('next.aiff'))

    expect(endNmlBatch()).toEqual([patch('next.aiff')])
  })

  // 300 tracks converting inside one processAll run must still yield exactly one
  // non-empty end — every intermediate state stays hidden until the outermost close.
  it('a large batch produces exactly one flush containing every patch', () => {
    beginNmlBatch()
    const files = Array.from({ length: 300 }, (_, i) => `track${i}.aiff`)
    for (const file of files) recordNmlPatch(patch(file))

    const flushed = endNmlBatch()

    expect(flushed).toHaveLength(300)
    expect(flushed.map((p) => p.file)).toEqual(files)
  })
})
