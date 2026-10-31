import type { PlaylistSource } from '../../../shared/types'
import i18n from '../i18n'
import type { Destination } from './destination'
import type { DjLibraryId } from './djLibraries'

export interface ExportLabelState {
  processing: boolean
  quiet?: boolean
  count?: number
  inPlace: boolean
  stale: boolean
  done: boolean
  withAppleMusic: boolean
  djTargets: DjLibraryId[]
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
  // The track already has a copy Surco added to Music, which converting an edit syncs
  // instead of adding a second one.
  inMusic?: boolean
  // Where the file lands, named on the button unless Apple Music already names it.
  destination?: Destination
  openSource?: PlaylistSource | null
}

function placeSuffix(state: ExportLabelState): 'Beside' | 'Overwrite' | null {
  if (state.destination === 'beside') return 'Beside'
  if (state.destination === 'overwrite') return 'Overwrite'
  return null
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
  // label is the one place the pending format shows: "Convert again to FLAC" over a WAV
  // export says what the next click writes, while a matching format stays the plain
  // "Convert again" instead of stating the obvious.
  if (state.quiet) {
    if (state.exportedFormat && state.format !== state.exportedFormat) {
      return { key: 'editor.reexportAs', options: { format: state.format } }
    }
    return { key: 'editor.reexport' }
  }
  const place = placeSuffix(state)
  const namesMusic = state.withAppleMusic && state.openSource !== 'appleMusic'
  const namedDj = state.djTargets.filter((id) => id !== state.openSource)
  const programs = programNames(namesMusic, namedDj)
  if (state.count !== undefined) {
    if (namedDj.length > 0) {
      return {
        key: place ? `editor.convertAll${place}To` : 'editor.convertAllTo',
        options: { count: state.count, format: state.format, programs },
      }
    }
    if (!state.withAppleMusic && place) {
      return {
        key: `editor.convertAll${place}`,
        options: { count: state.count, format: state.format },
      }
    }
    return {
      key: namesMusic ? 'editor.convertAllMusic' : 'editor.convertAll',
      options: { count: state.count, format: state.format },
    }
  }
  if (state.inPlace && state.tagsOnly)
    return { key: namesMusic ? 'editor.updateMusic' : 'editor.update' }
  if (state.stale && state.tagsOnly) return { key: 'editor.update' }
  if (state.stale && state.withAppleMusic && state.inMusic)
    return { key: 'editor.appleMusicUpdate' }
  if (state.done) return { key: 'editor.exportAgain' }
  if (state.replaces) {
    if (state.libraryBetter)
      return { key: 'editor.libraryHasBetter', options: { format: state.format } }
    return { key: 'editor.replaceMusic', options: { format: state.format } }
  }
  if (namedDj.length > 0) {
    return {
      key: place ? `editor.convert${place}To` : 'editor.convertTo',
      options: { format: state.format, programs },
    }
  }
  if (!state.withAppleMusic && place) {
    return { key: `editor.convert${place}`, options: { format: state.format } }
  }
  return {
    key: namesMusic ? 'editor.convert' : 'editor.convertNoMusic',
    options: { format: state.format },
  }
}

function programNames(namesMusic: boolean, djTargets: DjLibraryId[]): string {
  const ids = [...(namesMusic ? ['appleMusic'] : []), ...djTargets]
  return ids.map((id) => i18n.t(`settings.source.${id}`)).join(' + ')
}
