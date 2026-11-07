import {
  AudioWaveform,
  ChartColumn,
  Disc3,
  Flag,
  FolderOutput,
  Globe,
  Image,
  Keyboard,
  LayoutList,
  List,
  type LucideIcon,
  RefreshCw,
  SlidersHorizontal,
  SquarePen,
  Tag,
  Wrench,
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
  | 'programs'
  | 'naming'
  | 'editor'
  | 'layout'
  | 'fields'
  | 'artwork'
  | 'cues'
  | 'shortcuts'
  | 'stats'
  | 'advanced'

// A sidebar row. `id` is its first tab, the one a click opens; a row that joins several tabs
// shows them as a switcher above the panel, so fifteen tabs read as ten short rows. The
// joined tabs are the ones read together: the editor with its sections and fields, format
// with processing, naming with the output, shortcuts with stats.
export interface SettingsEntry {
  id: SettingsTab
  tabs: SettingsTab[]
}

const entry = (id: SettingsTab, ...more: SettingsTab[]): SettingsEntry => ({
  id,
  tabs: [id, ...more],
})

// The sidebar, grouped so the rows scan as four short runs instead of one long list.
// `heading` is an i18n key under settings.tabGroups (null on the opening group, which needs
// no label). Ordered by workflow within and across groups: set up the app and its sources,
// then how you edit metadata, then how the file is produced, then the utilities.
export const SETTINGS_ENTRY_GROUPS: { heading: string | null; entries: SettingsEntry[] }[] = [
  { heading: null, entries: [entry('general'), entry('search')] },
  {
    heading: 'editing',
    entries: [entry('editor', 'layout', 'fields'), entry('artwork'), entry('cues')],
  },
  {
    heading: 'output',
    entries: [entry('conversion', 'processing'), entry('naming', 'destination'), entry('programs')],
  },
  { heading: 'app', entries: [entry('shortcuts', 'stats'), entry('advanced')] },
]

export const SETTINGS_ENTRIES: SettingsEntry[] = SETTINGS_ENTRY_GROUPS.flatMap((g) => g.entries)

export function entryOf(tab: SettingsTab): SettingsEntry {
  return SETTINGS_ENTRIES.find((e) => e.tabs.includes(tab)) ?? SETTINGS_ENTRIES[0]
}

// The tabs grouped as before, derived from the rows so the two can never drift apart.
export const SETTINGS_TAB_GROUPS: { heading: string | null; tabs: SettingsTab[] }[] =
  SETTINGS_ENTRY_GROUPS.map((g) => ({ heading: g.heading, tabs: g.entries.flatMap((e) => e.tabs) }))

// The flat tab order, derived from the groups — the roving-tabindex sequence and the
// deep-link opener both read this, so a tab moved between groups moves here for free.
export const SETTINGS_TABS: SettingsTab[] = SETTINGS_TAB_GROUPS.flatMap((g) => g.tabs)

export const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  search: Globe,
  conversion: RefreshCw,
  processing: AudioWaveform,
  destination: FolderOutput,
  programs: Disc3,
  naming: Tag,
  editor: SquarePen,
  layout: LayoutList,
  fields: List,
  artwork: Image,
  cues: Flag,
  shortcuts: Keyboard,
  stats: ChartColumn,
  advanced: Wrench,
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
