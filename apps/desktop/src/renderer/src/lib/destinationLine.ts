import type { PlaylistSource } from '../../../shared/types'
import i18n from '../i18n'
import type { Destination } from './destination'
import type { DjLibraryId } from './djLibraries'

export interface DestinationLineState {
  destination: Destination
  withAppleMusic: boolean
  djTargets: DjLibraryId[]
  djHolds: DjLibraryId[]
  openSource: PlaylistSource | null
  inPlace: boolean
  inMusic: boolean
  replaces: boolean
  libraryBetter: boolean
  replacedFormat: string
  outputFolder: string
}

export interface LinePart {
  key: string
  options?: Record<string, unknown>
  warn?: true
}

const placeName = (id: string): string => i18n.t(`settings.source.${id}`)

export function destinationLine(s: DestinationLineState): { parts: LinePart[] } {
  const parts: LinePart[] = []
  const updated: string[] = []
  const added: string[] = []
  const synced: string[] = []

  if (s.destination === 'folder' && !s.inPlace) {
    parts.push({ key: 'editor.lineFolder', options: { folder: s.outputFolder } })
  } else if (s.destination === 'beside') {
    parts.push({ key: 'editor.lineBeside' })
  } else if (s.destination === 'overwrite') {
    parts.push({ key: 'editor.lineOverwrite' })
  }

  if (s.withAppleMusic || (s.openSource === 'appleMusic' && s.inPlace)) {
    if (s.replaces && s.libraryBetter) {
      parts.push({ key: 'editor.lineBetter', warn: true })
    } else if (s.replaces) {
      parts.push(
        s.replacedFormat
          ? { key: 'editor.lineReplaces', options: { format: s.replacedFormat } }
          : { key: 'editor.lineReplacesBare' },
      )
    } else if (s.inMusic || s.openSource === 'appleMusic') {
      updated.push(placeName('appleMusic'))
    } else {
      added.push(placeName('appleMusic'))
    }
  }

  for (const id of s.djTargets) {
    if (s.openSource === id || s.djHolds.includes(id)) updated.push(placeName(id))
    else synced.push(placeName(id))
  }

  if (updated.length > 0) {
    parts.push({ key: 'editor.lineUpdates', options: { places: updated.join(' · ') } })
  }
  if (added.length > 0) {
    parts.push({ key: 'editor.lineAdds', options: { places: added.join(' · ') } })
  }

  if (synced.length > 0) {
    parts.push({ key: 'editor.lineSyncs', options: { places: synced.join(' · ') } })
  }

  return { parts }
}
