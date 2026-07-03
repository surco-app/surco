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
  if (state.quiet) return { key: 'editor.reexport' }
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
