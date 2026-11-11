import type { Settings } from '../../shared/types'

export type BatteryFormat = 'wav' | 'aiff' | 'flac' | 'mp3' | 'm4a'

export interface BatteryTrack {
  format: BatteryFormat
  path: string
  title: string
  artist: string
  durationSec: number
}

export interface LibraryPlace {
  root: string
  home: string
}

export interface TestLibrary {
  build(place: LibraryPlace, tracks: BatteryTrack[], listName: string): Partial<Settings>
}
