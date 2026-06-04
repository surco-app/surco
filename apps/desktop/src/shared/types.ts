export type ThemePref = 'system' | 'light' | 'dark'

export type OutputFormat = 'aiff' | 'mp3' | 'wav' | 'flac'

export type SearchProviderId = 'discogs'

export interface Settings {
  theme: ThemePref
  discogsToken: string
  outputDir: string
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  filenameFormat: string
  groupingPresets: string[]
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  requiredFields: string[]
  coverMaxSize: number
  coverSquare: boolean
  showSpectrum: boolean
  hasSeenOnboarding: boolean
  conversionCount: number
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
  discNumber: string
  bpm: string
  key: string
  publisher: string
  catalogNumber: string
  remixArtist: string
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
  // The track length as Discogs returns it, e.g. "5:47". Optional: some releases
  // (and many tracklist positions like headings) carry no duration.
  duration?: string
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
  id: string
  inputPath: string
  outputName: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  format?: OutputFormat
  // Where this track's last conversion landed, so re-exporting it overwrites its
  // own file silently while a collision with an unrelated file still prompts.
  previousOutputPath?: string
}

export interface CoverExportJob {
  name: string
  coverUrl?: string
  coverPath?: string
}

export interface AppleMusicAddJob {
  outputPath: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
}

export type ProcessStage = 'cover' | 'converting' | 'appleMusic'

export interface ProcessProgress {
  id: string
  stage: ProcessStage
}

export interface ProcessResult {
  outputPath: string
  // True when the export matched the source format and rewrote the original file
  // (tags + rename) instead of writing a copy to the output folder. The renderer
  // then repoints the track at outputPath, since the original it loaded is gone.
  inPlace: boolean
  // True when the user chose to skip a conflicting export: nothing was written, so
  // the renderer leaves the track untouched rather than marking it done.
  skipped?: boolean
}

export interface SpectrumResult {
  image: string
  // null when the cutoff analysis failed (e.g. ffmpeg errored) but the image
  // still rendered — the UI then hides the quality verdict instead of inventing one.
  cutoffHz: number | null
  sampleRateHz: number
}
