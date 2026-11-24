import { describe, expect, it } from 'vitest'
import { type ExportLabelState, exportButtonLabel } from './exportLabel'

const base: ExportLabelState = {
  processing: false,
  inPlace: false,
  stale: false,
  done: false,
  format: 'AIFF',
  tagsOnly: true,
}

const rows: [ExportLabelState, string][] = [
  [{ ...base, processing: true, quiet: true, done: true }, 'editor.processing'],
  [{ ...base, inPlace: true }, 'editor.update'],
  [{ ...base, stale: true, done: true }, 'editor.update'],
  [{ ...base, inPlace: true, tagsOnly: false, sameFormat: true }, 'editor.updateAudio'],
  [{ ...base, stale: true, tagsOnly: false, sameFormat: true }, 'editor.updateAudio'],
  [{ ...base, inPlace: true, tagsOnly: false, sameFormat: false }, 'editor.convertAction'],
  [{ ...base, done: true }, 'editor.exportAgain'],
  [{ ...base, tagsOnly: false, libraryAction: 'replace' }, 'editor.replaceAction'],
  [
    { ...base, tagsOnly: false, libraryAction: 'replace', libraryBetter: true },
    'editor.libraryHasBetter',
  ],
  [{ ...base, tagsOnly: false, libraryAction: 'update' }, 'editor.update'],
  [{ ...base, tagsOnly: false, libraryAction: 'update', libraryBetter: true }, 'editor.update'],
  [{ ...base, tagsOnly: false }, 'editor.convertAction'],
  [{ ...base, inPlace: true, addsToMusic: true }, 'editor.add'],
  [{ ...base, inPlace: true, tagsOnly: false, sameFormat: true, addsToMusic: true }, 'editor.add'],
]

describe('exportButtonLabel', () => {
  // The label is a precedence chain; each row pins which state wins when several
  // apply, so adding a new state can't silently reshuffle the existing ones.
  it.each(rows)('resolves %o to %s', (state, key) => {
    expect(exportButtonLabel(state).key).toBe(key)
  })

  it('never names a destination', () => {
    for (const [state] of rows) {
      expect(exportButtonLabel(state).key).not.toMatch(/Music|To|Beside|Overwrite|All/)
    }
  })

  // The chosen format sits on the button's dropdown half, so the main half says only the
  // verb: "Convert | AIFF" instead of "Convert to AIFF | ⌄".
  it('leaves the format out of the convert, replace and replace anyway labels', () => {
    expect(exportButtonLabel({ ...base, tagsOnly: false }).options).toBeUndefined()
    expect(
      exportButtonLabel({ ...base, tagsOnly: false, libraryAction: 'replace' }).options,
    ).toBeUndefined()
    expect(
      exportButtonLabel({
        ...base,
        tagsOnly: false,
        libraryAction: 'replace',
        libraryBetter: true,
      }).options,
    ).toBeUndefined()
  })

  // A press must know whether it runs the library copy action or the usual conversion.
  it('names the library copy action only when the label comes from it, so a press knows what to run', () => {
    const library = (over: Partial<ExportLabelState>) =>
      exportButtonLabel({ ...base, tagsOnly: false, ...over }).library
    expect(library({ libraryAction: 'update' })).toBe('update')
    expect(library({ libraryAction: 'replace' })).toBe('replace')
    expect(library({ inPlace: true, tagsOnly: true, libraryAction: 'update' })).toBeUndefined()
    expect(library({ done: true, libraryAction: 'replace' })).toBeUndefined()
  })

  it('says anyway only when replacing a better copy, since Update leaves its audio alone', () => {
    const key = (libraryAction: 'update' | 'replace') =>
      exportButtonLabel({ ...base, tagsOnly: false, libraryAction, libraryBetter: true }).key
    expect(key('update')).toBe('editor.update')
    expect(key('replace')).toBe('editor.libraryHasBetter')
  })

  // After an export, picking a different format from the menu only relabels the button —
  // so the label is the ONLY place the pending format is visible. A bare "Convert again"
  // would export to FLAC while reading like a repeat of the WAV that just finished.
  it('names the pending format on the re-export button when it differs from the exported one', () => {
    const spec = exportButtonLabel({ ...base, quiet: true, format: 'FLAC', exportedFormat: 'WAV' })
    expect(spec.key).toBe('editor.reexportAs')
    expect(spec.options).toEqual({ format: 'FLAC' })
  })

  // A tags update repeats as an update: "Convert again" promised a conversion the next
  // click never runs, while the button that started it said "Update".
  it('repeats a tags update as an update, and a conversion as a conversion', () => {
    const again = (over: Partial<ExportLabelState>): string =>
      exportButtonLabel({ ...base, quiet: true, ...over }).key
    expect(again({ inPlace: true, tagsOnly: true })).toBe('editor.updateAgain')
    expect(again({ inPlace: true, tagsOnly: false })).toBe('editor.reexport')
    expect(again({ inPlace: false, tagsOnly: true })).toBe('editor.reexport')
  })

  it('keeps the plain re-export label while the format matches what was exported', () => {
    expect(
      exportButtonLabel({ ...base, quiet: true, format: 'WAV', exportedFormat: 'WAV' }).key,
    ).toBe('editor.reexport')
  })
})
