import {
  ChartColumn,
  FolderOutput,
  Image,
  Keyboard,
  List,
  type LucideIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
  Tag,
} from 'lucide-react'
import type { LocalDraft, SyncedDraft } from './settingsDraft'

// The single source of truth for the settings tabs: the modal renders them, and
// useOverlays types its deep-link opener against this so any tab is addressable
// without a second, drift-prone literal.
export type SettingsTab =
  | 'general'
  | 'search'
  | 'conversion'
  | 'destination'
  | 'naming'
  | 'editor'
  | 'fields'
  | 'artwork'
  | 'shortcuts'
  | 'stats'

// Ordered by workflow: app setup, where metadata comes from, how you edit it
// (editor prefs, its fields, the artwork), then producing the file (what → its
// name → where it lands), then utilities. Stats trails last as the one
// read-only, informational tab.
export const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'search',
  'editor',
  'fields',
  'artwork',
  'conversion',
  'naming',
  'destination',
  'shortcuts',
  'stats',
]

export const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  search: Search,
  conversion: RefreshCw,
  destination: FolderOutput,
  naming: Tag,
  editor: SquarePen,
  fields: List,
  artwork: Image,
  shortcuts: Keyboard,
  stats: ChartColumn,
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
