import { useSyncExternalStore } from 'react'
import type { CopiedTags } from '../types'
import type { Toast } from './toastQueue'
import type { ConversionFilter, LibraryFilter, QualityFilter, SortDir, TrackSort,
  DuplicatesFilter,
} from './triage'

// A surfaced background failure (a rejected IPC call, an unhandled rejection), stored as a
// key plus interpolation detail and localized at render so a language switch retranslates it.
export interface AppError {
  kind: 'unexpected' | 'settingsLoad' | 'settingsSave' | 'trash'
  detail?: string
}

// The UI-orchestration state App owns — held in a small external store (rather than
// useState) so stable callbacks can read the latest value via getState() instead of a
// ref-mirror, and so view chunks can subscribe to just their slice instead of being fed
// prop walls. Domain data (tracks, settings, analysis) stays in its own hooks; this is
// only the view's own bookkeeping. Grown one slice at a time as App migrates onto it.
export interface AppState {
  // Free-text filter over the imported tracks, combined with the quality chip.
  search: string
  // Display order of the (filtered) list. Defaults to the drop order.
  sortBy: TrackSort
  // Direction of the active sort. Ignored for the drop order, which has none.
  sortDir: SortDir
  // The list filter, one independent axis per dimension, all ANDed together so a DJ can
  // stack "not in Apple Music AND good AND WAV AND unconverted" at once. Null = no
  // constraint on that axis. Quality is the spectrum verdict (suspect/good/unanalyzed),
  // conversion the processing/provenance bucket, library the Apple Music ownership bucket,
  // format the source container ('WAV', 'FLAC'…).
  qualityFilter: QualityFilter | null
  conversionFilter: ConversionFilter | null
  libraryFilter: LibraryFilter | null
  duplicatesFilter: DuplicatesFilter | null
  formatFilter: string | null
  // True while a file drag is hovering the window, for the drop overlay.
  dragging: boolean
  // The unified notification queue: notices, failures, update prompts and new-track prompts
  // all live here as a stack so several can show at once instead of one corner clobbering
  // another. Each toast carries its own tone, optional action and auto-dismiss duration.
  toasts: Toast[]
  // Metadata copied from one track's context menu, to stamp onto another. Null until the
  // user copies, which is what gates the paste item in the row menu.
  copiedMeta: CopiedTags | null
}

export interface AppStore {
  getState: () => AppState
  setState: (patch: Partial<AppState>) => void
  subscribe: (listener: () => void) => () => void
}

const INITIAL: AppState = {
  search: '',
  sortBy: 'import',
  sortDir: 'asc',
  qualityFilter: null,
  conversionFilter: null,
  libraryFilter: null,
  duplicatesFilter: null,
  formatFilter: null,
  dragging: false,
  toasts: [],
  copiedMeta: null,
}

// Per-App-mount factory (mirrors createQueryClient): App holds the instance in a ref, so
// each test that renders <App/> gets a fresh store with no module-singleton leakage.
// Side-effect-free, since it runs in a useRef initializer under StrictMode double-invoke.
export function createAppStore(): AppStore {
  let state = INITIAL
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Subscribe to one slice of the store. Selectors must return a stored value (a field, not a
// freshly-derived object) so the snapshot stays referentially stable when nothing changed —
// which keeps re-renders scoped to the components whose slice actually moved.
export function useAppStore<T>(store: AppStore, selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}
