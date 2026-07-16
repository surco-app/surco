import { useCallback, useSyncExternalStore } from 'react'
import {
  DEFAULT_EDITOR_SECTIONS,
  type EditorSectionId,
  type EditorSectionPref,
} from '../../../shared/editorSections'

export type EditorSection = EditorSectionId

// The editor is keyed by track (it remounts per row), which would reset every section's
// collapsed state on each track switch. Holding it in a module-level store instead lets a
// "fold this away for now" survive browsing the crate — the section stays closed (and, via
// the analysis gating that reads `open`, stays unanalysed) until the user reopens it.
// The store boots from the shared defaults and is re-seeded with the user's own
// per-section preferences (Settings → Editor) once settings load — see seedEditorSections.
function toRecord(prefs: EditorSectionPref[]): Record<EditorSection, boolean> {
  return Object.fromEntries(prefs.map((p) => [p.id, p.open])) as Record<EditorSection, boolean>
}

let store: Record<EditorSection, boolean> = toRecord(DEFAULT_EDITOR_SECTIONS)

// The one section blown up to the whole window, if any. Module-level like the
// folds — and for the same reason, plus one more: surviving the per-track
// remount is what turns "maximize the beatgrid" into a review flow (arrow
// through the crate, every grid full-screen).
let maximized: EditorSection | null = null

// useSyncExternalStore plumbing, so a seed arriving after editors mounted (settings
// load async) updates them live instead of waiting for the next track switch.
const listeners = new Set<() => void>()
function emit(): void {
  for (const l of listeners) l()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Test seam: the store outlives renders by design, so without this it would leak folded
// state between tests. Resets it to defaults so each test starts clean.
export function resetEditorSections(): void {
  store = toRecord(DEFAULT_EDITOR_SECTIONS)
  maximized = null
  emit()
}

// Drop out of the full-window maximized view, from outside React. Surviving a per-track
// remount is deliberate (arrow through the crate with the beatgrid full-screen), but
// IMPORTING a new crate is a context change, not a track step: leaving the overlay up
// would paint the new track's still-analyzing spectrum across the whole window behind the
// editor. The import path calls this so a dropped folder always lands on the normal layout.
export function clearMaximizedSection(): void {
  if (maximized === null) return
  maximized = null
  emit()
}

// The live folded state of a section, read outside React by the list's hover prefetch so
// folding a section away stops its automatic analysis there too — not just inside the
// editor. Reads the module store directly so it always sees the latest toggle, the same
// way the prefetch reads refs for the latest settings.
export function editorSectionOpen(section: EditorSection): boolean {
  return store[section]
}

// Applies the user's per-section defaults (Settings → Editor) over the store. Called
// when settings load and when the user edits them — an explicit settings change is
// the one event that may override this session's ad-hoc folds.
export function seedEditorSections(prefs: EditorSectionPref[]): void {
  store = { ...store, ...toRecord(prefs) }
  emit()
}

export function useEditorSections(): {
  open: Record<EditorSection, boolean>
  setOpen: (section: EditorSection, open: boolean) => void
} {
  const open = useSyncExternalStore(subscribe, () => store)
  const setOpen = useCallback((section: EditorSection, value: boolean): void => {
    store = { ...store, [section]: value }
    emit()
  }, [])
  return { open, setOpen }
}

// The maximized-section state, shared by every SectionHeader (the toggle) and
// the Editor (the overlay). Maximizing implies opening: a folded section blown
// up to the window would be an empty header, and the analysis gating reads
// `open`.
export function useMaximizedSection(): {
  maximized: EditorSection | null
  setMaximized: (section: EditorSection | null) => void
} {
  const value = useSyncExternalStore(subscribe, () => maximized)
  const setMaximized = useCallback((section: EditorSection | null): void => {
    maximized = section
    if (section !== null) store = { ...store, [section]: true }
    emit()
  }, [])
  return { maximized: value, setMaximized }
}
