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

// Ordered by workflow: app setup, then output, then per-track editing prefs, then results.
// Stats trails last as the one read-only, informational tab.
export const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'search',
  'conversion',
  'destination',
  'naming',
  'editor',
  'fields',
  'artwork',
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

// The two staged-draft mutators every panel shares, so each tab can read/write the
// same draft objects the modal owns without re-deriving the generic signatures.
export type PatchSynced = <K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]) => void
export type PatchLocal = <K extends keyof LocalDraft>(key: K, value: LocalDraft[K]) => void
