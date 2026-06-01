export interface Settings {
  discogsToken: string
  outputDir: string
  addToAppleMusic: boolean
  filenameFormat: string
  groupingPresets: string[]
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  coverMaxSize: number
  coverSquare: boolean
}

export interface TrackMetadata {
  title: string
  artist: string
  album: string
  albumArtist: string
  year: string
  genre: string
  grouping: string
  comment: string
  trackNumber: string
}

export interface DiscogsSearchResult {
  id: number
  title: string
  year?: string
  thumb?: string
  cover_image?: string
  format?: string[]
  label?: string[]
}

export interface DiscogsTrack {
  position: string
  title: string
  artists?: { name: string }[]
}

export interface DiscogsRelease {
  id: number
  title: string
  artists: { name: string }[]
  year?: number
  genres?: string[]
  styles?: string[]
  labels?: { name: string; catno: string }[]
  images?: { uri: string; type: string; resource_url: string }[]
  tracklist: DiscogsTrack[]
}

export interface ProcessJob {
  inputPath: string
  outputName: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
}

export interface ProcessResult {
  outputPath: string
}

export interface SpectrumResult {
  image: string
  cutoffHz: number
  sampleRateHz: number
}
