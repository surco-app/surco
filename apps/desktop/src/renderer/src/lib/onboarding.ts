import {
  DEFAULT_EDITOR_SECTIONS,
  type EditorSectionId,
  type EditorSectionPref,
} from '../../../shared/editorSections'
import type { Settings } from '../../../shared/types'
import { buildSettingsPatch, type LocalDraft, type SyncedDraft } from './settingsDraft'

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

// The wizard stages its edits in the same drafts the Settings modal uses, plus the
// audio-intent question that only exists here.
interface OnboardingDrafts {
  synced: SyncedDraft
  local: LocalDraft
  // What the DJ does with the audio, which decides the editor's visible sections and
  // whether the spectrogram is on.
  audioIntents: AudioIntent[]
}

export function shouldShowOnboarding(settings: Pick<Settings, 'hasSeenOnboarding'>): boolean {
  return !settings.hasSeenOnboarding
}

// What the intent checkboxes start as. First run: unpicked (except the spectrum-backed
// quality) so the new DJ's editor stays minimal until they opt in. Re-run: read back
// from the sections each intent governs, so finishing untouched changes nothing —
// restore owns two sections and only seeds picked when both are visible, leaving a
// hand-arranged half state alone.
export function seedAudioIntents(
  settings: Pick<Settings, 'hasSeenOnboarding' | 'showSpectrum' | 'editorSections'>,
): AudioIntent[] {
  if (!settings.hasSeenOnboarding) return settings.showSpectrum ? ['quality'] : []
  const visible = (id: EditorSectionId): boolean =>
    settings.editorSections.find((s) => s.id === id)?.hidden !== true
  const intents: AudioIntent[] = []
  if (visible('trim') && visible('declick')) intents.push('restore')
  if (visible('normalize')) intents.push('level')
  if (settings.showSpectrum) intents.push('quality')
  return intents
}

// Passing null means the user skipped: we only flag the wizard as seen so it
// never reappears, leaving the existing (default) settings untouched.
export function buildOnboardingPatch(drafts: OnboardingDrafts | null): Partial<Settings> {
  if (!drafts) return { hasSeenOnboarding: true }
  return {
    // The shared serialization — trim/clamp/gating rules included — so a field (or a
    // rule) added to the Settings save path can never miss the wizard's.
    ...buildSettingsPatch(drafts.synced, drafts.local),
    // The spectrogram is the payload of the "check quality" intent; without it a
    // metadata-only DJ isn't paying for the analysis pass.
    showSpectrum: drafts.audioIntents.includes('quality'),
    editorSections: deriveEditorSections(drafts.audioIntents),
    hasSeenOnboarding: true,
  }
}
