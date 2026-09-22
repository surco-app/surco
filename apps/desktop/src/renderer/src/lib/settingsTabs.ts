import {
  FolderOutput,
  Keyboard,
  type LucideIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
  Tags,
} from 'lucide-react'
import type { LocalDraft, SyncedDraft } from './settingsDraft'

// The single source of truth for the settings tabs: the modal renders them, and
// useOverlays types its deep-link opener against this so any tab is addressable
// without a second, drift-prone literal.
export type SettingsTab =
  | 'general'
  | 'search'
  | 'output'
  | 'destination'
  | 'editor'
  | 'tags'
  | 'shortcuts'

// The sidebar order, which its arrow keys walk too: set up the app and its sources, then
// how you edit, then what comes out and where it goes, then the keyboard.
export const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'search',
  'editor',
  'tags',
  'output',
  'destination',
  'shortcuts',
]

export const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  search: Search,
  output: RefreshCw,
  destination: FolderOutput,
  editor: SquarePen,
  tags: Tags,
  shortcuts: Keyboard,
}

// Which control a settings option uses, so new panels match the existing ones instead of
// each author picking by feel (the drift a review flagged across these tabs):
//
//   • SegmentedControl (pills) — pick ONE of a few short options whose label says it all:
//     theme, language, output format, bit depth, key notation.
//   • Checkbox / CheckboxRow — an independent on/off switch: search providers, auto-match,
//     show spectrum/loudness, the artwork toggles.
//   • Radio (DestinationPicker) — pick ONE where each option needs a sentence of
//     explanation next to it: where converted tracks go.
//
// Rule of thumb: exclusive + self-evident → pills; exclusive + needs description → radios;
// standalone toggle → checkbox.

// The two staged-draft mutators every panel shares, so each tab can read/write the
// same draft objects the modal owns without re-deriving the generic signatures.
export type PatchSynced = <K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]) => void
export type PatchLocal = <K extends keyof LocalDraft>(key: K, value: LocalDraft[K]) => void
