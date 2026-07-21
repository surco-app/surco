import {
  AudioWaveform,
  ChartColumn,
  FolderOutput,
  Image,
  Keyboard,
  LayoutList,
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
  | 'processing'
  | 'destination'
  | 'naming'
  | 'editor'
  | 'layout'
  | 'fields'
  | 'artwork'
  | 'shortcuts'
  | 'stats'

// The tabs, grouped for the sidebar so twelve entries scan as four short runs instead of
// one long list. `heading` is an i18n key under settings.tabGroups (null on the opening
// group, which needs no label). Ordered by workflow within and across groups: set up the
// app and its sources, then how you edit metadata, then how the file is produced, then the
// utilities. SETTINGS_TABS below flattens this so the flat order and the grouped order can
// never drift apart.
export const SETTINGS_TAB_GROUPS: { heading: string | null; tabs: SettingsTab[] }[] = [
  { heading: null, tabs: ['general', 'search'] },
  { heading: 'editing', tabs: ['editor', 'layout', 'fields', 'artwork'] },
  { heading: 'output', tabs: ['conversion', 'processing', 'naming', 'destination'] },
  { heading: 'app', tabs: ['shortcuts', 'stats'] },
]

// The flat tab order, derived from the groups — the roving-tabindex sequence and the
// deep-link opener both read this, so a tab moved between groups moves here for free.
export const SETTINGS_TABS: SettingsTab[] = SETTINGS_TAB_GROUPS.flatMap((g) => g.tabs)

export const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  search: Search,
  conversion: RefreshCw,
  processing: AudioWaveform,
  destination: FolderOutput,
  naming: Tag,
  editor: SquarePen,
  layout: LayoutList,
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
