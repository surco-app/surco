import { autoMatchAvailable } from '../../../shared/autoMatch'
import {
  DEFAULT_EDITOR_SECTIONS,
  type EditorSectionId,
  type EditorSectionPref,
} from '../../../shared/editorSections'
import type { OutputFormat, SearchProviderId, Settings } from '../../../shared/types'

// What the DJ says they do with a track's audio, asked as plain intent rather than by
// naming the editor's sections directly. Each intent reveals the sections that serve it
// (and, for 'quality', turns on the spectrogram); an unpicked intent leaves its sections
// hidden so a metadata-only DJ never meets the audio-surgery tools. 'quality' is always
// offered; the metadata sections themselves are never optional (the product's core).
export type AudioIntent = 'restore' | 'level' | 'quality'

// Which sections each audio intent brings into view. Metadata sections (form, properties,
// quality, output) are always kept, so they aren't listed here.
const INTENT_SECTIONS: Record<AudioIntent, EditorSectionId[]> = {
  // Repairing a vinyl rip: trim the dead air, then heal the clicks.
  restore: ['trim', 'declick'],
  // Sizing the gain for a set.
  level: ['normalize'],
  // The verdict lives in the quality section, which is always shown — this intent only
  // unfolds it and switches on the spectrogram (see buildOnboardingPatch).
  quality: [],
}

// The sections that are part of the product's core and never hidden by the wizard,
// whatever audio intents are (or aren't) picked.
const ALWAYS_SHOWN: EditorSectionId[] = ['form', 'properties', 'quality', 'output']

// Turns the DJ's audio intents into an editor-section layout: sections an intent asks for
// stay visible, the always-shown core stays visible, everything else is hidden. Order and
// per-section fold defaults come from DEFAULT_EDITOR_SECTIONS so the reworked wizard can't
// drift from Settings → Editor. Fold state is left at those defaults — the quality intent
// carries its weight through showSpectrum (see buildOnboardingPatch), not by unfolding.
export function deriveEditorSections(intents: AudioIntent[]): EditorSectionPref[] {
  const revealed = new Set<EditorSectionId>(ALWAYS_SHOWN)
  for (const intent of intents) {
    for (const id of INTENT_SECTIONS[intent]) revealed.add(id)
  }
  return DEFAULT_EDITOR_SECTIONS.map((section) => ({
    ...section,
    ...(revealed.has(section.id) ? {} : { hidden: true }),
  }))
}

export interface OnboardingChoices {
  discogsToken: string
  // The catalogs the editor search queries (Discogs and/or Bandcamp).
  searchProviders: SearchProviderId[]
  outputFormat: OutputFormat
  // Where folder-copy conversions land, changeable right under the destination radio.
  outputDir: string
  // What the DJ does with the audio, which decides the editor's visible sections and
  // whether the spectrogram is on.
  audioIntents: AudioIntent[]
  autoMatch: boolean
  // The output destination, mirroring the Settings booleans (Apple Music is only offered
  // on macOS; Engine DJ and overwrite are offered everywhere).
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  // Rewrites the source files in place instead of producing copies (destructive).
  overwriteOriginal: boolean
  // Writes each conversion as a fresh file next to its source, original kept.
  convertBesideOriginal: boolean
  // Registers converted tracks in the Engine DJ library; its folder and playlist keep
  // their defaults here, tunable later in Settings.
  addToEngineDj: boolean
}

export function shouldShowOnboarding(settings: Pick<Settings, 'hasSeenOnboarding'>): boolean {
  return !settings.hasSeenOnboarding
}

// Passing null means the user skipped: we only flag the wizard as seen so it
// never reappears, leaving the existing (default) settings untouched.
export function buildOnboardingPatch(choices: OnboardingChoices | null): Partial<Settings> {
  if (!choices) return { hasSeenOnboarding: true }
  const discogsToken = choices.discogsToken.trim()
  return {
    discogsToken,
    searchProviders: choices.searchProviders,
    outputFormat: choices.outputFormat,
    outputDir: choices.outputDir,
    // The spectrogram is the payload of the "check quality" intent; without it a
    // metadata-only DJ isn't paying for the analysis pass.
    showSpectrum: choices.audioIntents.includes('quality'),
    editorSections: deriveEditorSections(choices.audioIntents),
    // Auto-match can only persist as on when its prerequisites are met (a source, plus a
    // Discogs token whenever Discogs is one), never just because the checkbox was left ticked.
    autoMatch:
      choices.autoMatch &&
      autoMatchAvailable({ searchProviders: choices.searchProviders, discogsToken }),
    addToAppleMusic: choices.addToAppleMusic,
    keepOutputCopy: choices.keepOutputCopy,
    overwriteOriginal: choices.overwriteOriginal,
    addToEngineDj: choices.addToEngineDj,
    convertBesideOriginal: choices.convertBesideOriginal,
    hasSeenOnboarding: true,
  }
}
