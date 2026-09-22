import { describe, expect, it } from 'vitest'
import { type ExportLabelState, exportButtonLabel } from './exportLabel'

const base: ExportLabelState = {
  processing: false,
  inPlace: false,
  stale: false,
  done: false,
  withAppleMusic: false,
  withEngineDj: false,
  format: 'AIFF',
  sameFormat: true,
}

describe('exportButtonLabel', () => {
  // The label is a precedence chain; each row pins which state wins when several
  // apply, so adding a new state can't silently reshuffle the existing ones.
  it.each([
    [{ ...base, processing: true, quiet: true, count: 2, done: true }, 'editor.processing'],
    [{ ...base, quiet: true, count: 2, inPlace: true }, 'editor.reexport'],
    [{ ...base, count: 2, inPlace: true, withAppleMusic: true }, 'editor.convertAllMusic'],
    [{ ...base, count: 2, inPlace: true, withEngineDj: true }, 'editor.convertAllEngine'],
    [{ ...base, count: 2, inPlace: true }, 'editor.convertAll'],
    [{ ...base, inPlace: true, stale: true, withAppleMusic: true }, 'editor.updateMusic'],
    [{ ...base, inPlace: true, stale: true }, 'editor.update'],
    [{ ...base, stale: true, done: true }, 'editor.update'],
    [{ ...base, done: true }, 'editor.exportAgain'],
    [{ ...base, withAppleMusic: true }, 'editor.convert'],
    [{ ...base, withEngineDj: true }, 'editor.convertEngine'],
    [base, 'editor.convertNoMusic'],
  ])('resolves %o to %s', (state, key) => {
    expect(exportButtonLabel(state).key).toBe(key)
  })

  it('hands the batch count and format through for interpolation', () => {
    expect(exportButtonLabel({ ...base, count: 3 }).options).toEqual({
      count: 3,
      format: 'AIFF',
    })
  })

  // After an export, picking a different format from the menu only relabels the button —
  // so the label is the ONLY place the pending format is visible. A bare "Convert again"
  // would export to FLAC while reading like a repeat of the WAV that just finished.
  it('names the pending format on the re-export button when it differs from the exported one', () => {
    const spec = exportButtonLabel({ ...base, quiet: true, format: 'FLAC', exportedFormat: 'WAV' })
    expect(spec.key).toBe('editor.reexportAs')
    expect(spec.options).toEqual({ format: 'FLAC' })
  })

  it('keeps the plain re-export label while the format matches what was exported', () => {
    expect(
      exportButtonLabel({ ...base, quiet: true, format: 'WAV', exportedFormat: 'WAV' }).key,
    ).toBe('editor.reexport')
  })

  // Reported 14/09: a FLAC loaded from a download folder, whose song is already in the
  // library as an MP3, offered "Convert to AIFF + Apple Music" — an add, leaving the user
  // holding both copies. When Surco knows which copy the file would supersede, the button
  // says so instead, and names it so the swap can be checked before it happens.
  it('offers to replace the library copy a loaded file supersedes', () => {
    expect(
      exportButtonLabel({
        processing: false,
        inPlace: false,
        stale: false,
        done: false,
        withAppleMusic: true,
        withEngineDj: false,
        format: 'AIFF',
        sameFormat: true,
        replaces: true,
      }),
    ).toEqual({ key: 'editor.replaceMusic', options: { format: 'AIFF' } })
  })

  // An in-place edit is already an update of the file itself; it must keep saying so
  // rather than claiming to replace a library copy.
  it('keeps the in-place update label over the replace offer', () => {
    expect(
      exportButtonLabel({
        processing: false,
        inPlace: true,
        stale: false,
        done: false,
        withAppleMusic: true,
        withEngineDj: false,
        format: 'AIFF',
        sameFormat: true,
        replaces: true,
      }),
    ).toEqual({ key: 'editor.updateMusic' })
  })

  // Nothing to supersede is the ordinary case, and the plain convert label stands.
  it('falls back to the convert label when there is nothing to replace', () => {
    expect(
      exportButtonLabel({
        processing: false,
        inPlace: false,
        stale: false,
        done: false,
        withAppleMusic: true,
        withEngineDj: false,
        format: 'AIFF',
        sameFormat: true,
      }),
    ).toEqual({ key: 'editor.convert', options: { format: 'AIFF' } })
  })

  // "Update tags" promises the audio is left alone. Overwriting a WAV with an AIFF is a
  // full conversion that happens to land on the original's path, and so is re-running a
  // done WAV→AIFF track: naming either a tag update undersells what the click does.
  it.each([
    [{ ...base, inPlace: true, sameFormat: false }, 'editor.convertNoMusic'],
    [{ ...base, inPlace: true, sameFormat: false, withAppleMusic: true }, 'editor.convert'],
    [{ ...base, stale: true, sameFormat: false }, 'editor.convertNoMusic'],
  ])('labels %o as a conversion, not a tag update', (state, key) => {
    expect(exportButtonLabel(state)).toEqual({ key, options: { format: 'AIFF' } })
  })
})
