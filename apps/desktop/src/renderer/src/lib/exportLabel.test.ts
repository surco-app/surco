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
  [{ ...base, tagsOnly: false, replaces: true }, 'editor.replaceAction'],
  [{ ...base, tagsOnly: false, replaces: true, libraryBetter: true }, 'editor.libraryHasBetter'],
  [{ ...base, tagsOnly: false }, 'editor.convertAction'],
]

describe('exportButtonLabel', () => {
  // The label is a precedence chain; each row pins which state wins when several
  // apply, so adding a new state can't silently reshuffle the existing ones.
  it.each(rows)('resolves %o to %s', (state, key) => {
    expect(exportButtonLabel(state).key).toBe(key)
  })

  // Where the file lands is the line's job; a button that also named it made the same
  // click read differently depending on which libraries were switched on.
  it('never names a destination', () => {
    for (const [state] of rows) {
      expect(exportButtonLabel(state).key).not.toMatch(/Music|To|Beside|Overwrite|All/)
    }
  })

  it('hands the format through for the convert, replace and replace anyway labels', () => {
    expect(exportButtonLabel({ ...base, tagsOnly: false }).options).toEqual({ format: 'AIFF' })
    expect(exportButtonLabel({ ...base, tagsOnly: false, replaces: true }).options).toEqual({
      format: 'AIFF',
    })
    expect(
      exportButtonLabel({ ...base, tagsOnly: false, replaces: true, libraryBetter: true }).options,
    ).toEqual({ format: 'AIFF' })
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
  // click never runs, while the button that started it said "Update tags".
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
