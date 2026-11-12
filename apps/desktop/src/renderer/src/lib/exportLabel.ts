export interface ExportLabelState {
  processing: boolean
  quiet?: boolean
  inPlace: boolean
  stale: boolean
  done: boolean
  // Already uppercased for display ("AIFF").
  format: string
  // What the last export actually produced (uppercased), null before any export. Lets
  // the quiet re-export label name the pending format when the menu changed it.
  exportedFormat?: string | null
  // True when the file would supersede a copy already in the library, so the button can
  // offer a replacement instead of an add. Ranked below the in-place and stale updates:
  // those already describe an update of the file itself.
  replaces?: boolean
  // The library's copy measured better than this file, so the replace offer says it goes
  // against that verdict ("anyway"). It still names the action, and pressing still replaces.
  libraryBetter?: boolean
  // Whether the pending output keeps the source's format with no filter re-rendering the
  // audio. Only then can an in-place or stale export be a tag update; otherwise it is a
  // real conversion.
  tagsOnly?: boolean
  sameFormat?: boolean
}

// Which label the convert split-button wears, as an i18n key plus its params. The
// order IS the precedence — an in-flight conversion beats everything.
// Early returns instead of a nested ternary so adding a seventh state can't
// silently change which existing state wins.
export function exportButtonLabel(state: ExportLabelState): {
  key: string
  options?: Record<string, unknown>
} {
  if (state.processing) return { key: 'editor.processing' }
  // Picking a format from the menu only relabels the button, so after an export the
  // label is the one place the pending format shows: "Convert again to FLAC" over a WAV
  // export says what the next click writes, while a matching format stays the plain
  // "Convert again" instead of stating the obvious.
  if (state.quiet) {
    if (state.exportedFormat && state.format !== state.exportedFormat) {
      return { key: 'editor.reexportAs', options: { format: state.format } }
    }
    if (state.inPlace && state.tagsOnly) return { key: 'editor.updateAgain' }
    return { key: 'editor.reexport' }
  }
  if (state.inPlace && state.tagsOnly) return { key: 'editor.update' }
  if (state.stale && state.tagsOnly) return { key: 'editor.update' }
  if (state.sameFormat && !state.tagsOnly && (state.inPlace || state.stale))
    return { key: 'editor.updateAudio' }
  if (state.done) return { key: 'editor.exportAgain' }
  if (state.replaces) {
    return {
      key: state.libraryBetter ? 'editor.libraryHasBetter' : 'editor.replaceAction',
      options: { format: state.format },
    }
  }
  return { key: 'editor.convertAction', options: { format: state.format } }
}
