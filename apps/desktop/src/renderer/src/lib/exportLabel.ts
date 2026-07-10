export interface ExportLabelState {
  processing: boolean
  quiet?: boolean
  count?: number
  inPlace: boolean
  stale: boolean
  done: boolean
  withAppleMusic: boolean
  withEngineDj: boolean
  // Already uppercased for display ("AIFF").
  format: string
  // What the last export actually produced (uppercased), null before any export. Lets
  // the quiet re-export label name the pending format when the menu changed it.
  exportedFormat?: string | null
}

// Which label the convert split-button wears, as an i18n key plus its params. The
// order IS the precedence — an in-flight conversion beats everything, the quiet
// re-export variant beats the batch count, and so on down to the plain convert.
// Early returns instead of a nested ternary so adding a seventh state can't
// silently change which existing state wins.
export function exportButtonLabel(state: ExportLabelState): {
  key: string
  options?: Record<string, unknown>
} {
  if (state.processing) return { key: 'editor.processing' }
  // Picking a format from the menu only relabels the button, so after an export the
  // label is the one place the pending format shows: "Re-export (FLAC)" over a WAV
  // export says what the next click writes, while a matching format stays the plain
  // "Re-export" instead of stating the obvious.
  if (state.quiet) {
    if (state.exportedFormat && state.format !== state.exportedFormat) {
      return { key: 'editor.reexportAs', options: { format: state.format } }
    }
    return { key: 'editor.reexport' }
  }
  if (state.count !== undefined) {
    return {
      key: state.withAppleMusic
        ? 'editor.convertAllMusic'
        : state.withEngineDj
          ? 'editor.convertAllEngine'
          : 'editor.convertAll',
      options: { count: state.count, format: state.format },
    }
  }
  if (state.inPlace) return { key: state.withAppleMusic ? 'editor.updateMusic' : 'editor.update' }
  if (state.stale) return { key: 'editor.update' }
  if (state.done) return { key: 'editor.exportAgain' }
  return {
    key: state.withAppleMusic
      ? 'editor.convert'
      : state.withEngineDj
        ? 'editor.convertEngine'
        : 'editor.convertNoMusic',
    options: { format: state.format },
  }
}
