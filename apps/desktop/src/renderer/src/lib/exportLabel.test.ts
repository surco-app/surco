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
})
