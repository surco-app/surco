// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  abandonNmlBatch,
  beginNmlBatch,
  endNmlBatch,
  recordedNmlPatch,
  recordNmlPatch,
  redirectNmlPatch,
} from './nmlBatch'

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

  // Un begin cuyo end no llega nunca — el renderer se recarga a media conversión, que
  // en esta app ya ha pasado (render-process-gone) — dejaría la profundidad clavada por
  // encima de cero: a partir de ahí ningún lote volvería a volcar y la colección se
  // quedaría sin actualizar en silencio hasta reiniciar la app. Abandonar el lote en
  // vuelo al recargar devuelve el acumulador a un estado limpio.
  it('recovers after a batch whose end never arrives', () => {
    beginNmlBatch()
    recordNmlPatch(patch('lost.aiff'))

    abandonNmlBatch()

    beginNmlBatch()
    recordNmlPatch(patch('after-reload.aiff'))
    expect(endNmlBatch()).toEqual([patch('after-reload.aiff')])
  })

  // Apple Music copies the converted temp file into its Media folder, which is often the
  // source's own folder: Traktor can only follow when FILE alone changes (DIR and VOLUME
  // are never rewritten), so the patch learns the landed name only in that case.
  describe('redirectNmlPatch', () => {
    const recorded = () => {
      beginNmlBatch()
      recordNmlPatch(patch('x.aiff'), { input: '/m/A/x.aiff', output: '/tmp/surco-1/x.wav' })
    }

    it('points the patch at the landed file when it sits in the source folder', () => {
      recorded()
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/A/x.wav')

      expect(endNmlBatch()[0].newFile).toBe('x.wav')
    })

    it('leaves the patch alone when the file landed in another folder', () => {
      recorded()
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/B/x.wav')

      expect(endNmlBatch()[0].newFile).toBeUndefined()
    })

    it('treats a decomposed source folder and a composed landed folder as the same', () => {
      beginNmlBatch()
      recordNmlPatch(patch('x.aiff'), {
        input: '/m/Ba\u0301sicos/x.aiff',
        output: '/tmp/surco-1/x.wav',
      })
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/B\u00e1sicos/x.wav')

      expect(endNmlBatch()[0].newFile).toBe('x.wav')
    })

    it('ignores a destination no patch was recorded for', () => {
      recorded()
      redirectNmlPatch('/tmp/surco-9/y.wav', '/m/A/y.wav')

      expect(endNmlBatch()[0].newFile).toBeUndefined()
    })

    // processTrack keeps the old file out of the trash offer when Traktor stays on it.
    it('reports whether Traktor follows the landed file', () => {
      recorded()
      recordNmlPatch(patch('y.aiff'), { input: '/m/A/y.aiff', output: '/tmp/surco-2/y.wav' })
      expect(redirectNmlPatch('/tmp/surco-1/x.wav', '/m/A/x.wav')).toBe(true)
      expect(redirectNmlPatch('/tmp/surco-2/y.wav', '/m/B/y.wav')).toBe(false)
      expect(redirectNmlPatch('/tmp/surco-9/z.wav', '/m/B/z.wav')).toBe(true)
      endNmlBatch()
    })

    // The temp the conversion wrote is deleted before the collection is saved, so the
    // thumbnails and the coexisting-entry check must read the file Music landed.
    it('points the output fields at the landed file, wherever it landed', () => {
      beginNmlBatch()
      recordNmlPatch(
        {
          ...patch('x.aiff'),
          outputPath: '/tmp/surco-1/x.wav',
          outputVolume: '',
          outputDir: '/:tmp/:surco-1/:',
          outputFile: 'x.wav',
        },
        { input: '/m/A/x.aiff', output: '/tmp/surco-1/x.wav' },
      )
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/B/x.wav', {
        volume: '',
        dir: '/:m/:B/:',
        file: 'x.wav',
      })

      expect(endNmlBatch()[0]).toMatchObject({
        outputPath: '/m/B/x.wav',
        outputVolume: '',
        outputDir: '/:m/:B/:',
        outputFile: 'x.wav',
      })
    })

    it('leaves outputPath unset when the conversion had no artwork to redraw', () => {
      recorded()
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/A/x.wav', {
        volume: '',
        dir: '/:m/:A/:',
        file: 'x.wav',
      })

      expect(endNmlBatch()[0].outputPath).toBeUndefined()
    })

    it('does not redirect a patch from an abandoned batch', () => {
      recorded()
      abandonNmlBatch()
      beginNmlBatch()
      recordNmlPatch(patch('x.aiff'))
      redirectNmlPatch('/tmp/surco-1/x.wav', '/m/A/x.wav')

      expect(endNmlBatch()[0].newFile).toBeUndefined()
    })
  })

  // The check after the batch judges Traktor against the patch the conversion recorded:
  // the last one for that source, the one the flush will write.
  it('hands back the patch last recorded for a source while its batch is open', () => {
    beginNmlBatch()
    const first = patch('x.aiff')
    const second = patch('x.aiff')
    recordNmlPatch(first, { input: '/m/x.aiff', output: '/m/x.wav' })
    recordNmlPatch(patch('y.aiff'), { input: '/m/y.aiff', output: '/m/y.wav' })
    recordNmlPatch(second, { input: '/m/x.aiff', output: '/m/x.flac' })

    expect(recordedNmlPatch('/m/x.aiff')).toBe(second)
    expect(recordedNmlPatch('/m/z.aiff')).toBeUndefined()
    endNmlBatch()
    expect(recordedNmlPatch('/m/x.aiff')).toBeUndefined()
  })
})
