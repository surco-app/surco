import { tagsOnly } from '../../../shared/audioProcessing'
import { editsInPlace, formatMatchesInput } from '../../../shared/format'
import type {
  DeclickConfig,
  FormatSetting,
  NormalizeConfig,
  OutputFormat,
  Settings,
} from '../../../shared/types'
import type { LibraryVerdict } from '../hooks/useLibraryVerdict'
import type { TrackItem } from '../types'
import { jobAudio } from './reapply'
import { fileHoldsTrack } from './upToDate'

// Where a converted track ends up. Modeled as one choice rather than independent
// toggles so "no copy anywhere" can't be expressed: every option keeps at least one copy.
// 'beside' writes the conversion as a fresh file next to the source, original kept.
// 'overwrite' rewrites the source file itself in place instead of producing a copy.
// Shared by Settings and the onboarding wizard so the two can never map the choice apart.
export type Destination = 'folder' | 'appleMusic' | 'beside' | 'overwrite'

export const DESTINATIONS: Destination[] = ['folder', 'appleMusic', 'beside', 'overwrite']

// Reads the stored booleans back as the single radio choice. Overwrite is its own axis
// and wins outright, then beside-original, which is FLAC-proof (a fresh FLAC beside the
// source is fine). FLAC can't go to Apple Music, so while it's the format the remaining
// destination is pinned to the output folder. keepOutputCopy no longer forks the read:
// the retired "output folder + Apple Music" choice collapses onto Apple Music here, and
// the stored copy flag keeps honoring an old setting until the user next saves.
export function toDestination(
  addToAppleMusic: boolean,
  flac: boolean,
  overwriteOriginal: boolean,
  convertBesideOriginal = false,
): Destination {
  if (overwriteOriginal) return 'overwrite'
  if (convertBesideOriginal) return 'beside'
  if (flac || !addToAppleMusic) return 'folder'
  return 'appleMusic'
}

// Maps the radio choice onto the stored booleans: Apple Music keeps its own imported
// copy, so choosing it drops the output-folder one. Beside-original writes its copy next
// to the source and does not add it to Apple Music. Overwrite rewrites the source
// itself, so it does not add to Apple Music either.
export function fromDestination(d: Destination): {
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
  convertBesideOriginal: boolean
} {
  if (d === 'overwrite') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
      convertBesideOriginal: false,
    }
  }
  if (d === 'beside') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      convertBesideOriginal: true,
    }
  }
  return {
    addToAppleMusic: d !== 'folder',
    keepOutputCopy: d !== 'appleMusic',
    overwriteOriginal: false,
    convertBesideOriginal: false,
  }
}

export type ExportDestinationContext = {
  item: TrackItem
  isMulti: boolean
  picked: ReturnType<typeof fromDestination>
  format: OutputFormat
  normalizeCfg: NormalizeConfig | undefined
  declickCfg: DeclickConfig | undefined
  normalize: Settings['normalize']
  declick: Settings['declick']
  destinationPicked: boolean
  destination: Destination
  addToAppleMusic: boolean
  formatPick: FormatSetting
  overwriteOriginal: boolean
  convertBesideOriginal: boolean
  macOS: boolean
}

export type ExportDestination = {
  willEditInPlace: boolean
  inSourceFolder: boolean
  lossyOverwrite: boolean
  tagsOnlyExport: boolean
  batchDestination: Destination
}

export function exportDestination({
  item,
  isMulti,
  picked,
  format,
  normalizeCfg,
  declickCfg,
  normalize,
  declick,
  destinationPicked,
  destination,
  addToAppleMusic,
  formatPick,
  overwriteOriginal,
  convertBesideOriginal,
  macOS,
}: ExportDestinationContext): ExportDestination {
  const willEditInPlace =
    !picked.convertBesideOriginal && editsInPlace(format, item.inputPath, picked.overwriteOriginal)
  const inSourceFolder =
    (picked.convertBesideOriginal && !picked.overwriteOriginal) ||
    editsInPlace(format, item.inputPath, picked.overwriteOriginal)
  // Overwriting a lossless master (WAV/AIFF/FLAC) with MP3 is the one irreversible,
  // quality-losing case worth a sharper warning before the user commits to it.
  const lossyOverwrite =
    picked.overwriteOriginal && format === 'mp3' && !formatMatchesInput('mp3', item.inputPath)
  const tagsOnlyExport =
    !isMulti &&
    tagsOnly(
      formatMatchesInput(format, item.inputPath),
      jobAudio(item, normalizeCfg, declickCfg, { normalize, declick }),
    )
  const batchDestination = destinationPicked
    ? destination
    : toDestination(
        addToAppleMusic && macOS,
        formatPick === 'flac',
        overwriteOriginal,
        convertBesideOriginal,
      )
  return { willEditInPlace, inSourceFolder, lossyOverwrite, tagsOnlyExport, batchDestination }
}

export type ExportReadinessContext = {
  item: TrackItem
  isMulti: boolean
  picked: ReturnType<typeof fromDestination>
  format: OutputFormat
  inLibrary: LibraryVerdict['inLibrary']
  willEditInPlace: boolean
  tagsOnlyExport: boolean
  defaultOutputName: string
  incomplete: boolean
  batchAddsToMusic: boolean
  batchTagsOnly: boolean
  selectionHeld: boolean
}

export type ExportReadiness = {
  addsToMusic: boolean
  upToDate: boolean
}

export function exportReadiness({
  item,
  isMulti,
  picked,
  format,
  inLibrary,
  willEditInPlace,
  tagsOnlyExport,
  defaultOutputName,
  incomplete,
  batchAddsToMusic,
  batchTagsOnly,
  selectionHeld,
}: ExportReadinessContext): ExportReadiness {
  const addsToMusic =
    !isMulti &&
    picked.addToAppleMusic &&
    willEditInPlace &&
    formatMatchesInput(format, item.inputPath) &&
    inLibrary === 'no' &&
    !item.fromAppleMusic
  const upToDate = isMulti
    ? !batchAddsToMusic && !incomplete && batchTagsOnly && selectionHeld
    : !addsToMusic &&
      !incomplete &&
      willEditInPlace &&
      tagsOnlyExport &&
      fileHoldsTrack(item, defaultOutputName)
  return { addsToMusic, upToDate }
}
