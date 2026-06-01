import type { TrackMetadata } from '../../../shared/types'

export interface FieldDef {
  key: keyof TrackMetadata
  label: string
  wide?: boolean
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'title', label: 'Título', wide: true },
  { key: 'artist', label: 'Artista' },
  { key: 'albumArtist', label: 'Artista del álbum' },
  { key: 'album', label: 'Álbum' },
  { key: 'year', label: 'Año' },
  { key: 'genre', label: 'Género' },
  { key: 'grouping', label: 'Grouping' },
  { key: 'trackNumber', label: 'Nº pista' },
  { key: 'comment', label: 'Comentario', wide: true }
]

export const DEFAULT_FIELDS: string[] = FIELD_DEFS.map((d) => d.key)

export function moveItem<T>(arr: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(index, 1)
  copy.splice(to, 0, item)
  return copy
}
